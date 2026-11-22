package com.kaivra.app;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Random;

/**
 * Kaivra's own brain, running on the phone. Reads brain.bin (written by brain/model.py) and runs the
 * transformer token by token: int8 weights, rotary positions, a key/value cache, and its own tokenizer.
 * Pure Java, no libraries.
 */
final class KaivraBrain {
    static final int END = 256, USER = 257, KAIVRA = 258, FACT = 259, FIRST_MERGE = 264;

    final int vocab, dim, layers, heads, hidden, ctx, headDim;
    final float eps;
    final String meta;
    private final double theta;

    private final byte[] emb;
    private final float[] embS, norm;
    private final float[][] attnNorm, mlpNorm, wqS, wkS, wvS, woS, w1S, w3S, w2S;
    private final byte[][] wq, wk, wv, wo, w1, w3, w2;

    // tokenizer
    private final HashMap<Long, Integer> rank = new HashMap<>();
    private final byte[][] tokenBytes;
    private final HashMap<String, int[]> pieceCache = new HashMap<>();

    // working memory
    private final float[][] kCache, vCache;
    private final float[] x, xb, xb2, q, k, v, att, hb, hb2, logits, freqs;

    KaivraBrain(File file) throws IOException {
        ByteBuffer b;
        try (RandomAccessFile raf = new RandomAccessFile(file, "r"); FileChannel ch = raf.getChannel()) {
            b = ch.map(FileChannel.MapMode.READ_ONLY, 0, ch.size());
        }
        b.order(ByteOrder.LITTLE_ENDIAN);
        byte[] magic = new byte[4];
        b.get(magic);
        if (magic[0] != 'K' || magic[1] != 'V' || magic[2] != 'B' || magic[3] != '1') throw new IOException("not a Kaivra brain file");
        int version = b.getInt();
        if (version != 1) throw new IOException("brain version " + version + " needs a newer app");
        vocab = b.getInt(); dim = b.getInt(); layers = b.getInt(); heads = b.getInt(); hidden = b.getInt(); ctx = b.getInt();
        headDim = dim / heads;
        theta = b.getFloat();
        eps = b.getFloat();
        int nMerges = b.getInt();
        tokenBytes = new byte[FIRST_MERGE + nMerges][];
        for (int i = 0; i < 256; i++) tokenBytes[i] = new byte[]{(byte) i};
        for (int i = 256; i < FIRST_MERGE; i++) tokenBytes[i] = new byte[0];
        for (int i = 0; i < nMerges; i++) {
            int a = b.getInt(), c = b.getInt();
            rank.put(((long) a << 32) | c, i);
            byte[] ba = tokenBytes[a], bc = tokenBytes[c];
            byte[] m = new byte[ba.length + bc.length];
            System.arraycopy(ba, 0, m, 0, ba.length);
            System.arraycopy(bc, 0, m, ba.length, bc.length);
            tokenBytes[FIRST_MERGE + i] = m;
        }
        byte[] mj = new byte[b.getInt()];
        b.get(mj);
        meta = new String(mj, StandardCharsets.UTF_8);

        emb = bytes(b, vocab * dim);
        embS = floats(b, vocab);
        attnNorm = new float[layers][]; mlpNorm = new float[layers][];
        wq = new byte[layers][]; wk = new byte[layers][]; wv = new byte[layers][]; wo = new byte[layers][];
        w1 = new byte[layers][]; w3 = new byte[layers][]; w2 = new byte[layers][];
        wqS = new float[layers][]; wkS = new float[layers][]; wvS = new float[layers][]; woS = new float[layers][];
        w1S = new float[layers][]; w3S = new float[layers][]; w2S = new float[layers][];
        for (int l = 0; l < layers; l++) {
            attnNorm[l] = floats(b, dim);
            wq[l] = bytes(b, dim * dim); wqS[l] = floats(b, dim);
            wk[l] = bytes(b, dim * dim); wkS[l] = floats(b, dim);
            wv[l] = bytes(b, dim * dim); wvS[l] = floats(b, dim);
            wo[l] = bytes(b, dim * dim); woS[l] = floats(b, dim);
            mlpNorm[l] = floats(b, dim);
            w1[l] = bytes(b, hidden * dim); w1S[l] = floats(b, hidden);
            w3[l] = bytes(b, hidden * dim); w3S[l] = floats(b, hidden);
            w2[l] = bytes(b, dim * hidden); w2S[l] = floats(b, dim);
        }
        norm = floats(b, dim);

        kCache = new float[layers][ctx * dim];
        vCache = new float[layers][ctx * dim];
        x = new float[dim]; xb = new float[dim]; xb2 = new float[dim];
        q = new float[dim]; k = new float[dim]; v = new float[dim];
        att = new float[ctx]; hb = new float[hidden]; hb2 = new float[hidden];
        logits = new float[vocab];
        freqs = new float[headDim / 2];
        for (int i = 0; i < headDim / 2; i++) freqs[i] = (float) Math.pow(theta, -2.0 * i / headDim);
    }

    private static byte[] bytes(ByteBuffer b, int n) { byte[] a = new byte[n]; b.get(a); return a; }

    private static float[] floats(ByteBuffer b, int n) { float[] a = new float[n]; b.asFloatBuffer().get(a); b.position(b.position() + 4 * n); return a; }

    // ---------------- tokenizer (same rules as brain/tokenizer.py) ----------------

    private static int charClass(int cp) {
        if (cp == ' ') return 'S';
        if (Character.isLetter(cp)) return 'L';
        int t = Character.getType(cp);
        if (t == Character.NON_SPACING_MARK || t == Character.ENCLOSING_MARK || t == Character.COMBINING_SPACING_MARK) return 'L';
        if (Character.isDigit(cp)) return 'D';
        return 'O';
    }

    static List<String> pieces(String text) {
        List<String> out = new ArrayList<>();
        int i = 0, n = text.length();
        while (i < n) {
            int start = i;
            if (text.charAt(i) == ' ' && i + 1 < n && text.charAt(i + 1) != ' ') i++;
            int cp = text.codePointAt(i);
            int c = charClass(cp);
            i += Character.charCount(cp);
            if (c == 'L') {
                while (i < n) {
                    int cp2 = text.codePointAt(i);
                    if (charClass(cp2) != 'L') break;
                    i += Character.charCount(cp2);
                }
            }
            out.add(text.substring(start, i));
        }
        return out;
    }

    private int[] encodePiece(String p) {
        int[] cached = pieceCache.get(p);
        if (cached != null) return cached;
        byte[] by = p.getBytes(StandardCharsets.UTF_8);
        int[] w = new int[by.length];
        int len = by.length;
        for (int i = 0; i < len; i++) w[i] = by[i] & 0xff;
        while (len > 1) {
            int best = Integer.MAX_VALUE, bi = -1;
            for (int j = 0; j < len - 1; j++) {
                Integer r = rank.get(((long) w[j] << 32) | w[j + 1]);
                if (r != null && r < best) { best = r; bi = j; }
            }
            if (bi < 0) break;
            w[bi] = FIRST_MERGE + best;
            System.arraycopy(w, bi + 2, w, bi + 1, len - bi - 2);
            len--;
        }
        int[] out = new int[len];
        System.arraycopy(w, 0, out, 0, len);
        if (pieceCache.size() < 50000) pieceCache.put(p, out);
        return out;
    }

    List<Integer> encode(String text) {
        List<Integer> ids = new ArrayList<>();
        for (String p : pieces(text)) for (int t : encodePiece(p)) ids.add(t);
        return ids;
    }

    String decode(List<Integer> ids) {
        int n = 0;
        for (int t : ids) n += tokenBytes[t].length;
        byte[] out = new byte[n];
        int pos = 0;
        for (int t : ids) { byte[] tb = tokenBytes[t]; System.arraycopy(tb, 0, out, pos, tb.length); pos += tb.length; }
        return new String(out, StandardCharsets.UTF_8);
    }

    // ---------------- the transformer ----------------

    private void rmsnorm(float[] out, float[] in, float[] g) {
        double ss = 0;
        for (int i = 0; i < dim; i++) ss += in[i] * in[i];
        float r = (float) (1.0 / Math.sqrt(ss / dim + eps));
        for (int i = 0; i < dim; i++) out[i] = in[i] * r * g[i];
    }

    /** out[o] = scale[o] * sum_i in[i] * w[o][i] */
    private static void matmul(float[] out, float[] in, byte[] w, float[] scale, int rows, int cols) {
        for (int o = 0; o < rows; o++) {
            int base = o * cols;
            float s0 = 0, s1 = 0, s2 = 0, s3 = 0;
            int i = 0;
            for (; i + 3 < cols; i += 4) {
                s0 += in[i] * w[base + i];
                s1 += in[i + 1] * w[base + i + 1];
                s2 += in[i + 2] * w[base + i + 2];
                s3 += in[i + 3] * w[base + i + 3];
            }
            for (; i < cols; i++) s0 += in[i] * w[base + i];
            out[o] = (s0 + s1 + s2 + s3) * scale[o];
        }
    }

    private void rope(float[] vec, int pos) {
        for (int h = 0; h < heads; h++) {
            for (int i = 0; i < headDim / 2; i++) {
                double ang = pos * (double) freqs[i];
                float c = (float) Math.cos(ang), s = (float) Math.sin(ang);
                int j = h * headDim + 2 * i;
                float a = vec[j], bb = vec[j + 1];
                vec[j] = a * c - bb * s;
                vec[j + 1] = a * s + bb * c;
            }
        }
    }

    /** Runs one token at position pos; fills logits when wantLogits. */
    private void step(int token, int pos, boolean wantLogits) {
        float es = embS[token];
        for (int i = 0; i < dim; i++) x[i] = emb[token * dim + i] * es;
        float scale = (float) (1.0 / Math.sqrt(headDim));
        for (int l = 0; l < layers; l++) {
            rmsnorm(xb, x, attnNorm[l]);
            matmul(q, xb, wq[l], wqS[l], dim, dim);
            matmul(k, xb, wk[l], wkS[l], dim, dim);
            matmul(v, xb, wv[l], wvS[l], dim, dim);
            rope(q, pos);
            rope(k, pos);
            System.arraycopy(k, 0, kCache[l], pos * dim, dim);
            System.arraycopy(v, 0, vCache[l], pos * dim, dim);
            float[] kc = kCache[l], vc = vCache[l];
            for (int h = 0; h < heads; h++) {
                int ho = h * headDim;
                float mx = Float.NEGATIVE_INFINITY;
                for (int t = 0; t <= pos; t++) {
                    float s = 0;
                    int kb = t * dim + ho;
                    for (int i = 0; i < headDim; i++) s += q[ho + i] * kc[kb + i];
                    s *= scale;
                    att[t] = s;
                    if (s > mx) mx = s;
                }
                float sum = 0;
                for (int t = 0; t <= pos; t++) { float e = (float) Math.exp(att[t] - mx); att[t] = e; sum += e; }
                for (int i = 0; i < headDim; i++) xb2[ho + i] = 0;
                for (int t = 0; t <= pos; t++) {
                    float a = att[t] / sum;
                    int vb = t * dim + ho;
                    for (int i = 0; i < headDim; i++) xb2[ho + i] += a * vc[vb + i];
                }
            }
            matmul(xb, xb2, wo[l], woS[l], dim, dim);
            for (int i = 0; i < dim; i++) x[i] += xb[i];
            rmsnorm(xb, x, mlpNorm[l]);
            matmul(hb, xb, w1[l], w1S[l], hidden, dim);
            matmul(hb2, xb, w3[l], w3S[l], hidden, dim);
            for (int i = 0; i < hidden; i++) {
                float u = hb[i];
                hb[i] = u / (1f + (float) Math.exp(-u)) * hb2[i];
            }
            matmul(xb, hb, w2[l], w2S[l], dim, hidden);
            for (int i = 0; i < dim; i++) x[i] += xb[i];
        }
        if (!wantLogits) return;
        rmsnorm(xb, x, norm);
        matmul(logits, xb, emb, embS, vocab, dim);
    }

    /** Logits after reading the whole prompt (for checking against the trainer). */
    float[] logitsFor(List<Integer> ids) {
        for (int p = 0; p < ids.size(); p++) step(ids.get(p), p, p == ids.size() - 1);
        return logits.clone();
    }

    // ---------------- talking ----------------

    /** history: pairs {question, answer}, oldest first. fact: text from the knowledge library, or null. */
    synchronized String reply(String question, List<String[]> history, String fact, Random rng) {
        int maxNew = 90;
        List<Integer> tail = new ArrayList<>();
        if (fact != null && !fact.isEmpty()) {
            tail.add(FACT);
            List<Integer> f = encode(fact);
            if (f.size() > 140) f = f.subList(0, 140);
            tail.addAll(f);
        }
        tail.add(USER);
        List<Integer> qi = encode(question);
        if (qi.size() > 60) qi = qi.subList(0, 60);
        tail.addAll(qi);
        tail.add(KAIVRA);
        List<List<Integer>> turns = new ArrayList<>();
        for (String[] h : history) {
            List<Integer> t = new ArrayList<>();
            t.add(USER); t.addAll(encode(h[0])); t.add(KAIVRA); t.addAll(encode(h[1])); t.add(END);
            turns.add(t);
        }
        int room = ctx - maxNew - 1 - tail.size();
        int first = turns.size();
        int used = 0;
        while (first > 0 && used + turns.get(first - 1).size() <= room) { first--; used += turns.get(first).size(); }
        List<Integer> ids = new ArrayList<>();
        ids.add(END);
        for (int i = first; i < turns.size(); i++) ids.addAll(turns.get(i));
        ids.addAll(tail);

        for (int p = 0; p < ids.size() - 1; p++) step(ids.get(p), p, false);
        int pos = ids.size() - 1;
        int token = ids.get(pos);
        List<Integer> out = new ArrayList<>();
        boolean[] seen = new boolean[vocab];
        while (out.size() < maxNew && pos < ctx) {
            step(token, pos, true);
            for (int i = 0; i < vocab; i++) if (seen[i]) logits[i] = logits[i] > 0 ? logits[i] / 1.15f : logits[i] * 1.15f;
            int next = sample(logits, rng);
            if (next == END || next == USER || next == KAIVRA || next == FACT) break;
            out.add(next);
            seen[next] = true;
            token = next;
            pos++;
        }
        return decode(out).trim();
    }

    private int sample(float[] lg, Random rng) {
        final int K = 30;
        final float temp = 0.6f;
        int[] top = new int[K];
        float[] val = new float[K];
        int n = 0;
        for (int i = 0; i < vocab; i++) {
            if (i >= END && i < FIRST_MERGE && i != END) continue;
            float s = lg[i];
            if (n < K) {
                int j = n++;
                while (j > 0 && val[j - 1] < s) { val[j] = val[j - 1]; top[j] = top[j - 1]; j--; }
                val[j] = s; top[j] = i;
            } else if (s > val[K - 1]) {
                int j = K - 1;
                while (j > 0 && val[j - 1] < s) { val[j] = val[j - 1]; top[j] = top[j - 1]; j--; }
                val[j] = s; top[j] = i;
            }
        }
        double sum = 0;
        double[] pr = new double[n];
        for (int j = 0; j < n; j++) { pr[j] = Math.exp((val[j] - val[0]) / temp); sum += pr[j]; }
        double r = rng.nextDouble() * sum;
        for (int j = 0; j < n; j++) { r -= pr[j]; if (r <= 0) return top[j]; }
        return top[0];
    }
}
