package com.kaivra.app;

import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;

/**
 * Kaivra's recorded voice, written from scratch: speaks by joining short pieces of real recorded speech.
 * Each piece runs from the middle of one speech sound to the middle of the next (a diphone). For every sentence
 * Kaivra picks the pieces that best fit (same neighbouring sounds, stress, word and phrase position) and that join
 * most smoothly (similar spectrum, pitch and loudness at the joins; pieces that were next to each other in the
 * recording join perfectly), then joins them in step with the voice's vibration so the seams are not heard.
 * The pieces come from a voice pack built by brain/voice/build_units.py from free recordings (CMU ARCTIC).
 */
public final class KaivraUnits {
    static final int SR = 16000;

    final String name;
    private final String[] phones;
    private final HashMap<String, Integer> phoneId = new HashMap<>();
    private final float[] cepScale = new float[13];
    private final int[] uttOff, uttLen;
    private final int n;
    private final short[] uL, uR, uPP, uNN, perL, perR, lf0L, lf0R, enL, enR;
    private final int[] uUtt, uLeft, uRight;
    private final byte[] sL, sR, flags, cepL, cepR;
    private final java.nio.ByteBuffer audio; // mu-law samples (memory-mapped from the pack file on the phone)
    final int version;
    private java.nio.IntBuffer marks;        // version 2: pitch marks (position * 2 + voiced) of every sentence
    private int[] markStart;
    private final HashMap<Integer, float[]> durStats = new HashMap<>(); // per sound pair: mean, sd of log length
    private float medianLf0;
    private final HashMap<Integer, int[]> byPair = new HashMap<>();
    private static final float[] MU = new float[256];

    static {
        for (int q = 0; q < 256; q++) {
            double y = q / 255.0 * 2 - 1;
            MU[q] = (float) (Math.signum(y) * (Math.pow(256, Math.abs(y)) - 1) / 255.0);
        }
    }

    // ---------------- loading ----------------

    private static int i32(DataInputStream d) throws IOException { return Integer.reverseBytes(d.readInt()); }
    private static short i16(DataInputStream d) throws IOException { return Short.reverseBytes(d.readShort()); }
    private static float f32(DataInputStream d) throws IOException { return Float.intBitsToFloat(i32(d)); }
    private static String str(DataInputStream d) throws IOException {
        byte[] b = new byte[d.readUnsignedByte()];
        d.readFully(b);
        return new String(b, "US-ASCII");
    }

    /** Opens an uncompressed voice pack file; the recorded sound stays in the file (memory-mapped), not in memory. */
    static KaivraUnits open(java.io.File file) throws IOException {
        try (java.io.RandomAccessFile f = new java.io.RandomAccessFile(file, "r")) {
            return new KaivraUnits(new java.io.FileInputStream(f.getFD()), f.getChannel());
        }
    }

    /** Reads an uncompressed voice pack from a stream (the caller unzips it). */
    KaivraUnits(InputStream raw) throws IOException { this(raw, null); }

    private KaivraUnits(InputStream raw, java.nio.channels.FileChannel channel) throws IOException {
        final long[] pos = {0};
        InputStream counted = new java.io.FilterInputStream(new java.io.BufferedInputStream(raw, 1 << 16)) {
            @Override public int read() throws IOException { int b = super.read(); if (b >= 0) pos[0]++; return b; }
            @Override public int read(byte[] b, int off, int len) throws IOException { int r = super.read(b, off, len); if (r > 0) pos[0] += r; return r; }
        };
        DataInputStream d = new DataInputStream(counted);
        byte[] magic = new byte[4];
        d.readFully(magic);
        if (magic[0] != 'K' || magic[1] != 'V' || magic[2] != 'U' || magic[3] != '1') throw new IOException("not a Kaivra voice pack");
        version = i32(d);
        if (i32(d) != SR) throw new IOException("unexpected sample rate");
        int np = i32(d);
        name = str(d);
        phones = new String[np];
        for (int i = 0; i < np; i++) { phones[i] = str(d); phoneId.put(phones[i], i); }
        for (int i = 0; i < 13; i++) cepScale[i] = f32(d);
        int nu = i32(d);
        uttOff = new int[nu]; uttLen = new int[nu];
        for (int i = 0; i < nu; i++) { uttOff[i] = i32(d); uttLen[i] = i32(d); }
        n = i32(d);
        uL = new short[n]; uR = new short[n]; uPP = new short[n]; uNN = new short[n]; perL = new short[n]; perR = new short[n];
        lf0L = new short[n]; lf0R = new short[n]; enL = new short[n]; enR = new short[n];
        uUtt = new int[n]; uLeft = new int[n]; uRight = new int[n];
        sL = new byte[n]; sR = new byte[n]; flags = new byte[n]; cepL = new byte[n * 13]; cepR = new byte[n * 13];
        HashMap<Integer, ArrayList<Integer>> pairs = new HashMap<>();
        for (int i = 0; i < n; i++) {
            uL[i] = i16(d); uR[i] = i16(d); uPP[i] = i16(d); uNN[i] = i16(d);
            uUtt[i] = i32(d); uLeft[i] = i32(d); uRight[i] = i32(d);
            perL[i] = i16(d); perR[i] = i16(d);
            sL[i] = d.readByte(); sR[i] = d.readByte(); flags[i] = d.readByte(); d.readByte();
            lf0L[i] = i16(d); lf0R[i] = i16(d); enL[i] = i16(d); enR[i] = i16(d);
            d.readFully(cepL, i * 13, 13);
            d.readFully(cepR, i * 13, 13);
            ArrayList<Integer> list = pairs.get(uL[i] * 1024 + uR[i]);
            if (list == null) { list = new ArrayList<>(); pairs.put(uL[i] * 1024 + uR[i], list); }
            list.add(i);
        }
        for (java.util.Map.Entry<Integer, ArrayList<Integer>> e : pairs.entrySet()) {
            int[] a = new int[e.getValue().size()];
            for (int i = 0; i < a.length; i++) a[i] = e.getValue().get(i);
            byPair.put(e.getKey(), a);
        }
        int len = i32(d);
        if (channel != null) {
            audio = channel.map(java.nio.channels.FileChannel.MapMode.READ_ONLY, pos[0], len);
            if (version >= 2) {
                long at = pos[0] + len;
                java.nio.ByteBuffer mb = channel.map(java.nio.channels.FileChannel.MapMode.READ_ONLY, at, channel.size() - at)
                        .order(java.nio.ByteOrder.LITTLE_ENDIAN);
                int total = mb.getInt();
                markStart = new int[nu + 1];
                for (int i = 0; i <= nu; i++) markStart[i] = mb.getInt();
                java.nio.ByteBuffer rest = mb.slice().order(java.nio.ByteOrder.LITTLE_ENDIAN);
                marks = rest.asIntBuffer();
                if (marks.capacity() < total) { marks = null; markStart = null; }
            }
        } else {
            byte[] a = new byte[len];
            d.readFully(a);
            audio = java.nio.ByteBuffer.wrap(a);
            if (version >= 2) {
                int total = i32(d);
                markStart = new int[nu + 1];
                for (int i = 0; i <= nu; i++) markStart[i] = i32(d);
                int[] m = new int[total];
                for (int i = 0; i < total; i++) m[i] = i32(d);
                marks = java.nio.IntBuffer.wrap(m);
            }
        }
        // typical length of every sound pair (to avoid pieces that are much too long or short: often mislabelled)
        int pau = phone("pau");
        java.util.ArrayList<Float> lf0s = new java.util.ArrayList<>();
        for (java.util.Map.Entry<Integer, int[]> e : byPair.entrySet()) {
            int[] us = e.getValue();
            if (us.length < 4 || uL[us[0]] == pau || uR[us[0]] == pau) continue;
            double sum = 0, sq = 0;
            for (int u : us) { double l = Math.log(Math.max(40, uRight[u] - uLeft[u])); sum += l; sq += l * l; }
            double mean = sum / us.length, sd = Math.sqrt(Math.max(1e-4, sq / us.length - mean * mean));
            durStats.put(e.getKey(), new float[]{(float) mean, (float) Math.max(0.08, sd)});
        }
        for (int i = 0; i < n; i += 7) if (lf0L[i] != 0) lf0s.add((float) lf0L[i]);
        java.util.Collections.sort(lf0s);
        medianLf0 = lf0s.isEmpty() ? 0 : lf0s.get(lf0s.size() / 2);
    }

    /** True when the pack carries pitch marks, so pitch and loudness can be smoothed across the joins. */
    boolean smooth() { return marks != null && PSOLA != 0; }

    int phone(String p) { Integer i = phoneId.get(p); return i == null ? -1 : i; }

    int units() { return n; }

    // ---------------- what to say ----------------

    /** One speech sound to say, with its place in the word and phrase. ph = -1 means a pause of pauseMs. */
    static final class Target {
        int ph = -1, stress = -1, pauseMs;
        boolean wordStart, wordEnd, phraseFinal, phraseInitial;
    }

    // similar sounds to use when a pair of sounds was never recorded
    private static final String[][] SIMILAR = {
        {"ax", "ah", "ih", "eh"}, {"ah", "ax", "aa", "eh"}, {"axr", "er", "r"}, {"er", "axr", "r"}, {"ix", "ih", "ax"},
        {"ih", "ix", "iy", "eh"}, {"iy", "ih", "ey"}, {"eh", "ae", "ih"}, {"ae", "eh", "aa"}, {"aa", "ao", "ah"},
        {"ao", "aa", "ow"}, {"uh", "uw", "ah"}, {"uw", "uh", "ow"}, {"ey", "eh", "iy"}, {"ay", "aa", "ae"},
        {"aw", "aa", "ao"}, {"oy", "ao", "ow"}, {"ow", "ao", "uw"}, {"dx", "t", "d"}, {"t", "dx", "d"}, {"d", "dx", "t"},
        {"p", "b"}, {"b", "p"}, {"k", "g"}, {"g", "k"}, {"f", "th", "v"}, {"th", "f", "dh"}, {"v", "dh", "f"},
        {"dh", "v", "th", "d"}, {"s", "z"}, {"z", "s"}, {"sh", "zh", "s"}, {"zh", "sh", "z"}, {"ch", "sh", "t"},
        {"jh", "zh", "d"}, {"hh", "pau"}, {"hv", "hh"}, {"m", "n"}, {"n", "m", "ng"}, {"ng", "n"}, {"nx", "n"},
        {"em", "m"}, {"en", "n"}, {"el", "l"}, {"l", "el", "w"}, {"r", "er"}, {"w", "uw", "l"}, {"y", "iy"}};

    private int[] alternatives(int p) {
        ArrayList<Integer> out = new ArrayList<>();
        String name = p >= 0 && p < phones.length ? phones[p] : "pau";
        for (String[] s : SIMILAR) if (s[0].equals(name)) for (int k = 1; k < s.length; k++) { int q = phone(s[k]); if (q >= 0) out.add(q); }
        int[] a = new int[out.size()];
        for (int i = 0; i < a.length; i++) a[i] = out.get(i);
        return a;
    }

    private int[] candidates(int l, int r) {
        int[] c = byPair.get(l * 1024 + r);
        if (c != null) return c;
        for (int r2 : alternatives(r)) { c = byPair.get(l * 1024 + r2); if (c != null) return c; }
        for (int l2 : alternatives(l)) { c = byPair.get(l2 * 1024 + r); if (c != null) return c; }
        for (int l2 : alternatives(l)) for (int r2 : alternatives(r)) { c = byPair.get(l2 * 1024 + r2); if (c != null) return c; }
        return new int[0];
    }

    // ---------------- choosing the pieces ----------------

    static float W_CONTEXT = 1.0f, W_STRESS = 1.5f, W_WORD = 1.0f, W_FINAL = 2.0f, W_INITIAL = 1.0f, W_JOIN = 1.0f;
    static float W_SPEC = 1.0f, W_F0J = 5.0f, W_VOICING = 2.0f, W_EN = 0.08f;  // join: spectrum, pitch, voicing, loudness
    static float W_DUR = 2.0f, DUR_FREE = 1.5f;   // pieces much longer or shorter than usual for their sounds
    static float W_PITCH = 0.0f;                  // pieces far from the speaker's usual pitch
    static int KEEP = 80;                         // candidates kept per join (picked by the naturalness test)
    // joining: pitch-synchronous overlap-add that meets pitch and loudness half-way at every join
    static int PSOLA = 1;
    static float SPAN_MS = 50f, MAX_SHIFT = 0.3f, F0_SMOOTH = 1.0f, GAIN_SMOOTH = 1.0f;

    private float targetCost(int u, int pp, int nn, int stL, int stR, int fl) {
        float c = 0;
        if (uPP[u] != pp) c += W_CONTEXT;
        if (uNN[u] != nn) c += W_CONTEXT;
        if (stL >= 0 && (sL[u] > 0) != (stL > 0)) c += W_STRESS;
        if (stR >= 0 && (sR[u] > 0) != (stR > 0)) c += W_STRESS;
        if (((flags[u] ^ fl) & 1) != 0) c += W_WORD;
        if (((flags[u] ^ fl) & 2) != 0) c += W_FINAL;
        if (((flags[u] ^ fl) & 4) != 0) c += W_INITIAL;
        if (((flags[u] ^ fl) & 8) != 0) c += W_WORD * 0.5f;
        if (W_DUR > 0) {
            float[] st = durStats.get(uL[u] * 1024 + uR[u]);
            if (st != null) {
                float z = Math.abs(((float) Math.log(Math.max(40, uRight[u] - uLeft[u])) - st[0]) / st[1]);
                if ((fl & 2) != 0 && uRight[u] - uLeft[u] > Math.exp(st[0])) z = Math.max(0, z - 1f); // phrase ends are longer
                if (z > DUR_FREE) c += W_DUR * (z - DUR_FREE);
            }
        }
        if (W_PITCH > 0 && medianLf0 != 0) {
            if (lf0L[u] != 0) c += W_PITCH * Math.abs(lf0L[u] - medianLf0) / 1000f;
            if (lf0R[u] != 0) c += W_PITCH * Math.abs(lf0R[u] - medianLf0) / 1000f;
        }
        return c;
    }

    private boolean adjacent(int a, int b) { return b == a + 1 && uUtt[a] == uUtt[b] && uRight[a] == uLeft[b]; }

    private float joinCost(int a, int b) {
        if (adjacent(a, b)) return 0;
        float d = 0;
        for (int k = 0; k < 13; k++) { float x = cepR[a * 13 + k] - cepL[b * 13 + k]; d += x * x; }
        float c = W_SPEC * (float) Math.sqrt(d) / 20f;
        boolean va = lf0R[a] != 0, vb = lf0L[b] != 0;
        if (va && vb) c += W_F0J * Math.abs(lf0R[a] - lf0L[b]) / 1000f;
        else if (va != vb) c += W_VOICING;
        c += W_EN * Math.abs(enR[a] - enL[b]) / 100f;
        return c * W_JOIN;
    }

    /** The best pieces for one phrase (pause, sounds, pause), or null if nothing fits. */
    private int[] choose(List<Target> ph) {
        int pau = phone("pau");
        int m = ph.size() + 2;
        int[] seq = new int[m];
        Target[] tg = new Target[m];
        seq[0] = pau; seq[m - 1] = pau;
        for (int i = 0; i < ph.size(); i++) { seq[i + 1] = ph.get(i).ph; tg[i + 1] = ph.get(i); }
        int steps = m - 1;
        int[][] cand = new int[steps][];
        float[][] tc = new float[steps][];
        for (int k = 0; k < steps; k++) {
            int l = seq[k], r = seq[k + 1];
            int pp = k > 0 ? seq[k - 1] : pau, nn = k + 2 < m ? seq[k + 2] : pau;
            Target a = tg[k], b = tg[k + 1];
            int stL = a != null ? a.stress : -1, stR = b != null ? b.stress : -1;
            int fl = 0;
            if (b != null && b.wordStart) fl |= 1;
            if (b != null && b.phraseFinal) fl |= 2;
            if (a != null && a.phraseInitial) fl |= 4;
            if (a != null && a.wordEnd) fl |= 8;
            int[] all = candidates(l, r);
            if (all.length == 0) return null;
            float[] cost = new float[all.length];
            for (int i = 0; i < all.length; i++) cost[i] = targetCost(all[i], pp, nn, stL, stR, fl);
            // keep the best few, plus the pieces that follow on directly from last step's pieces
            Integer[] order = new Integer[all.length];
            for (int i = 0; i < all.length; i++) order[i] = i;
            final float[] cc = cost;
            Arrays.sort(order, (x, y) -> Float.compare(cc[x], cc[y]));
            ArrayList<Integer> keep = new ArrayList<>();
            java.util.HashSet<Integer> seen = new java.util.HashSet<>();
            for (int i = 0; i < Math.min(KEEP, all.length); i++) { keep.add(order[i]); seen.add(all[order[i]]); }
            if (k > 0) {
                java.util.HashMap<Integer, Integer> pos = new java.util.HashMap<>();
                for (int i = 0; i < all.length; i++) pos.put(all[i], i);
                for (int u : cand[k - 1]) {
                    Integer i = pos.get(u + 1);
                    if (i != null && !seen.contains(u + 1) && adjacent(u, u + 1)) { keep.add(i); seen.add(u + 1); }
                }
            }
            cand[k] = new int[keep.size()];
            tc[k] = new float[keep.size()];
            for (int i = 0; i < keep.size(); i++) { cand[k][i] = all[keep.get(i)]; tc[k][i] = cost[keep.get(i)]; }
        }
        // best path through the pieces (Viterbi)
        float[][] best = new float[steps][];
        int[][] back = new int[steps][];
        best[0] = tc[0].clone();
        back[0] = new int[cand[0].length];
        for (int k = 1; k < steps; k++) {
            best[k] = new float[cand[k].length];
            back[k] = new int[cand[k].length];
            for (int j = 0; j < cand[k].length; j++) {
                float bv = Float.MAX_VALUE; int bi = 0;
                for (int i = 0; i < cand[k - 1].length; i++) {
                    float v = best[k - 1][i] + joinCost(cand[k - 1][i], cand[k][j]);
                    if (v < bv) { bv = v; bi = i; }
                }
                best[k][j] = bv + tc[k][j];
                back[k][j] = bi;
            }
        }
        int[] path = new int[steps];
        int bi = 0;
        for (int j = 1; j < best[steps - 1].length; j++) if (best[steps - 1][j] < best[steps - 1][bi]) bi = j;
        for (int k = steps - 1; k >= 0; k--) { path[k] = cand[k][bi]; bi = back[k][bi]; }
        return path;
    }

    // ---------------- joining the pieces ----------------

    private float sample(int utt, int i) {
        if (i < 0 || i >= uttLen[utt]) return 0;
        return MU[audio.get(uttOff[utt] + i) & 0xff];
    }

    private int halfWindow(int a, int b) {
        int pa = perR[a], pb = perL[b];
        int p = pa > 0 && pb > 0 ? (pa + pb) / 2 : 40;
        return Math.max(40, Math.min(200, p));
    }

    /** Joins the chosen pieces: in step with the voice at each seam, with loudness matched across the seam. */
    private int render(int[] path, float[] out, int pos) {
        for (int i = 0; i < path.length; i++) {
            int u = path[i];
            int utt = uUtt[u], left = uLeft[u], right = uRight[u];
            boolean joinPrev = i > 0 && !adjacent(path[i - 1], u);
            boolean joinNext = i + 1 < path.length && !adjacent(u, path[i + 1]);
            int hIn = joinPrev ? halfWindow(path[i - 1], u) : 0;
            int hOut = joinNext ? halfWindow(u, path[i + 1]) : 0;
            hIn = Math.min(hIn, left);
            hOut = Math.min(hOut, uttLen[utt] - right);
            float g0 = 1f;
            if (joinPrev) {
                float db = (enR[path[i - 1]] - enL[u]) / 100f;
                g0 = (float) Math.pow(10, Math.max(-8, Math.min(8, db)) / 20);
            }
            int len = right - left;
            for (int s = -hIn; s < len + hOut; s++) {
                int o = pos + s;
                if (o < 0 || o >= out.length) continue;
                float g = g0 + (1f - g0) * Math.max(0, Math.min(1, (float) s / Math.max(1, len)));
                float w = 1f;
                if (s < hIn) w = 0.5f - 0.5f * (float) Math.cos(Math.PI * (s + hIn) / (2.0 * hIn));
                if (s >= len - hOut) w *= 0.5f + 0.5f * (float) Math.cos(Math.PI * (s - (len - hOut)) / (2.0 * hOut));
                out[o] += w * g * sample(utt, left + s);
            }
            pos += len;
        }
        return pos;
    }

    // ---------------- joining with pitch marks (pack version 2) ----------------

    private int markPos(int i) { return marks.get(i) >> 1; }

    private boolean markVoiced(int i) { return (marks.get(i) & 1) != 0; }

    /** The pitch mark of sentence utt nearest to sample p, or -1. */
    private int nearestMark(int utt, int p) {
        int lo = markStart[utt], hi = markStart[utt + 1] - 1;
        if (hi < lo) return -1;
        int a = lo, b = hi + 1;
        while (a < b) { int m = (a + b) >>> 1; if (markPos(m) < p) a = m + 1; else b = m; }
        if (a > hi) return hi;
        if (a > lo && p - markPos(a - 1) <= markPos(a) - p) return a - 1;
        return a;
    }

    /**
     * Joins the chosen pieces one voice period at a time (pitch-synchronous overlap-add). At every join the pitch and
     * the loudness of the two pieces meet half-way, changing gradually over SPAN_MS on each side, so the voice glides
     * instead of jumping. Pieces that were next to each other in the recording are left exactly as recorded.
     */
    private int renderSmooth(int[] path, float[] out, int pos) {
        int n = path.length;
        float[] dF = new float[n], dE = new float[n], J = new float[n];
        for (int i = 1; i < n; i++) {
            int a = path[i - 1], b = path[i];
            if (adjacent(a, b)) continue;
            int ua = uUtt[a], ub = uUtt[b];
            int ma = nearestMark(ua, uRight[a]), mb = nearestMark(ub, uLeft[b]);
            float pa = 0, pb = 0;
            if (ma > markStart[ua] && markVoiced(ma) && markVoiced(ma - 1)) pa = markPos(ma) - markPos(ma - 1);
            if (mb >= 0 && mb + 1 < markStart[ub + 1] && markVoiced(mb) && markVoiced(mb + 1)) pb = markPos(mb + 1) - markPos(mb);
            if (pa > 0 && pb > 0) dF[i] = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, (float) Math.log(pb / pa))) * F0_SMOOTH;
            float ea = enR[a] / 100f, eb = enL[b] / 100f;
            if (ea > -40 && eb > -40) dE[i] = Math.max(-8f, Math.min(8f, eb - ea)) * GAIN_SMOOTH;
        }
        float span = Math.max(1f, SPAN_MS * SR / 1000f);
        int t = pos;
        for (int i = 0; i < n; i++) {
            int u = path[i], utt = uUtt[u], left = uLeft[u], right = uRight[u];
            int T = t;
            J[i] = T;
            float est = T;
            for (int k = i + 1; k < Math.min(n, i + 5); k++) { est += uRight[path[k - 1]] - uLeft[path[k - 1]]; J[k] = est; }
            int lo = markStart[utt], hi = markStart[utt + 1] - 1;
            int guard = 0;
            while (guard++ < 4000) {
                int tau = left + (t - T);
                if (tau >= right) break;
                int m = nearestMark(utt, tau);
                if (m < 0) break;
                int A = markPos(m);
                if (A >= right) break; // the rest belongs to the next piece
                int l = m > lo ? A - markPos(m - 1) : 0;
                int r = m < hi ? markPos(m + 1) - A : 0;
                if (l <= 0) l = r;
                if (r <= 0) r = l;
                if (r <= 0) { l = 80; r = 80; }
                l = Math.max(16, Math.min(400, l));
                r = Math.max(16, Math.min(400, r));
                float c = 0, gdb = 0;
                for (int k = Math.max(1, i - 3); k < Math.min(n, i + 5); k++) {
                    if (dF[k] == 0 && dE[k] == 0) continue;
                    float dt = t - J[k];
                    float phi = 1f - Math.abs(dt) / span;
                    if (phi <= 0) continue;
                    float sgn = dt < 0 ? 0.5f : -0.5f;
                    c += sgn * dF[k] * phi;
                    gdb += sgn * dE[k] * phi;
                }
                float g = gdb == 0 ? 1f : (float) Math.pow(10, gdb / 20);
                for (int s = -l; s <= r; s++) {
                    int o = t + s;
                    if (o < 0 || o >= out.length) continue;
                    float w = s < 0 ? 0.5f + 0.5f * (float) Math.cos(Math.PI * s / l) : 0.5f + 0.5f * (float) Math.cos(Math.PI * s / r);
                    out[o] += g * w * sample(utt, A + s);
                }
                int step = markVoiced(m) && c != 0 ? Math.round(r * (float) Math.exp(c)) : r;
                t += Math.max(16, step);
            }
        }
        return t;
    }

    /** Speech for the targets as 16-bit PCM, or null if some sound pair cannot be made from this pack. */
    short[] speak(List<Target> targets) {
        List<int[]> paths = new ArrayList<>();
        List<Integer> pauses = new ArrayList<>();
        List<Target> phrase = new ArrayList<>();
        int total = 0;
        for (int i = 0; i <= targets.size(); i++) {
            Target t = i < targets.size() ? targets.get(i) : null;
            if (t == null || t.ph < 0) {
                if (!phrase.isEmpty()) {
                    int[] p = choose(phrase);
                    if (p == null) return null;
                    paths.add(p);
                    for (int u : p) total += uRight[u] - uLeft[u];
                    pauses.add(t == null ? 0 : Math.max(0, t.pauseMs - 100));
                    total += 400 + (t == null ? 0 : t.pauseMs * SR / 1000);
                    phrase = new ArrayList<>();
                }
                continue;
            }
            phrase.add(t);
        }
        if (paths.isEmpty()) return new short[0];
        float[] out = new float[total + total / 8 + SR / 2];
        int pos = 400;
        for (int k = 0; k < paths.size(); k++) {
            pos = smooth() ? renderSmooth(paths.get(k), out, pos) : render(paths.get(k), out, pos);
            pos += pauses.get(k) * SR / 1000;
        }
        int end = Math.min(out.length, pos + 400);
        float peak = 1e-6f;
        for (int i = 0; i < end; i++) peak = Math.max(peak, Math.abs(out[i]));
        float gain = 0.9f / peak;
        short[] pcm = new short[end];
        for (int i = 0; i < end; i++) pcm[i] = (short) Math.round(Math.max(-1f, Math.min(1f, out[i] * gain)) * 32000);
        return pcm;
    }
}
