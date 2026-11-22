package com.kaivra.app;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteOrder;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Kaivra's own knowledge library (library.bin, built by brain/data.py from Simple English Wikipedia).
 * Finds the article a question is about by binary search over normalised titles; same rules as brain/library.py.
 */
final class KaivraLibrary {
    private final MappedByteBuffer b;
    private final int na, nk, artOff, keyOff, keyArt, artBase, keyBase;
    final int articles;

    KaivraLibrary(File file) throws IOException {
        try (RandomAccessFile raf = new RandomAccessFile(file, "r"); FileChannel ch = raf.getChannel()) {
            b = ch.map(FileChannel.MapMode.READ_ONLY, 0, ch.size());
        }
        b.order(ByteOrder.LITTLE_ENDIAN);
        if (b.get(0) != 'K' || b.get(1) != 'V' || b.get(2) != 'L' || b.get(3) != '1') throw new IOException("not a Kaivra library");
        na = b.getInt(4);
        nk = b.getInt(8);
        artOff = 12;
        keyOff = artOff + 4 * (na + 1);
        keyArt = keyOff + 4 * (nk + 1);
        artBase = keyArt + 4 * nk;
        keyBase = artBase + b.getInt(artOff + 4 * na);
        articles = na;
    }

    // ---------------- normalising (same as data.py norm_key) ----------------

    static String normKey(String s) {
        String t = Normalizer.normalize(s.toLowerCase(Locale.ROOT).replace("&", " and "), Normalizer.Form.NFKD);
        StringBuilder sb = new StringBuilder(t.length());
        for (int i = 0; i < t.length(); ) {
            int cp = t.codePointAt(i);
            i += Character.charCount(cp);
            int type = Character.getType(cp);
            if (type == Character.NON_SPACING_MARK || type == Character.ENCLOSING_MARK || type == Character.COMBINING_SPACING_MARK) continue;
            if (Character.isLetter(cp) || Character.isDigit(cp)) sb.appendCodePoint(cp);
            else sb.append(' ');
        }
        List<String> words = new ArrayList<>();
        for (String w : sb.toString().split(" ")) if (!w.isEmpty()) words.add(w);
        while (!words.isEmpty() && (words.get(0).equals("the") || words.get(0).equals("a") || words.get(0).equals("an"))) words.remove(0);
        return String.join(" ", words);
    }

    private static final String[] LEADS = {
        "tell me something about", "tell me about", "what do you know about", "do you know about", "do you know",
        "what is meant by", "what is the meaning of", "meaning of", "what does", "information about", "info about",
        "search for", "look up", "define", "describe", "explain",
        "what is", "what s", "whats", "what are", "what was", "what were",
        "who is", "who s", "whos", "who was", "who are", "who were",
        "where is", "where s", "wheres", "where was", "where are", "where were",
        "when was", "when is",
    };
    private static final String[] FILLERS = {"hey kaivra", "ok kaivra", "kaivra", "please", "can you", "could you", "would you", "will you", "can u"};
    private static final String[] TAILS = {" mean", " means", " please", " for me", " kaivra"};

    static String subjectOf(String question) {
        String q = normKey(question);
        boolean changed = true;
        while (changed) {
            changed = false;
            for (String f : FILLERS) {
                if (q.equals(f)) return "";
                if (q.startsWith(f + " ")) { q = q.substring(f.length() + 1); changed = true; }
            }
        }
        boolean found = false;
        for (String lead : LEADS) {
            if (q.startsWith(lead + " ")) { q = q.substring(lead.length() + 1); found = true; break; }
        }
        for (String t : TAILS) if (q.endsWith(t)) q = q.substring(0, q.length() - t.length());
        List<String> words = new ArrayList<>();
        for (String w : q.split(" ")) if (!w.isEmpty()) words.add(w);
        while (!words.isEmpty() && (words.get(0).equals("the") || words.get(0).equals("a") || words.get(0).equals("an"))) words.remove(0);
        if (!found && words.size() > 4) return "";
        return String.join(" ", words);
    }

    // ---------------- lookup ----------------

    private int compareKey(int i, byte[] k) {
        int s = b.getInt(keyOff + 4 * i), e = b.getInt(keyOff + 4 * (i + 1));
        int n = e - s;
        for (int j = 0; j < n && j < k.length; j++) {
            int x = b.get(keyBase + s + j) & 0xff, y = k[j] & 0xff;
            if (x != y) return x - y;
        }
        return n - k.length;
    }

    private int findKey(String key) {
        byte[] k = key.getBytes(StandardCharsets.UTF_8);
        int lo = 0, hi = nk - 1;
        while (lo <= hi) {
            int mid = (lo + hi) >>> 1;
            int c = compareKey(mid, k);
            if (c == 0) return b.getInt(keyArt + 4 * mid);
            if (c < 0) lo = mid + 1; else hi = mid - 1;
        }
        return -1;
    }

    private String[] article(int i) {
        int s = b.getInt(artOff + 4 * i), e = b.getInt(artOff + 4 * (i + 1));
        byte[] by = new byte[e - s];
        for (int j = 0; j < by.length; j++) by[j] = b.get(artBase + s + j);
        String t = new String(by, StandardCharsets.UTF_8);
        int tab = t.indexOf('\t');
        return new String[]{t.substring(0, tab), t.substring(tab + 1)};
    }

    /** {title, fact} for the subject of the question, or null. */
    String[] lookup(String question) {
        String s = subjectOf(question);
        if (s.isEmpty()) return null;
        List<String> tries = new ArrayList<>();
        tries.add(s);
        if (s.endsWith("ies")) tries.add(s.substring(0, s.length() - 3) + "y");
        if (s.endsWith("es")) tries.add(s.substring(0, s.length() - 2));
        if (s.endsWith("s")) tries.add(s.substring(0, s.length() - 1));
        for (String t : tries) {
            int i = findKey(t);
            if (i >= 0) return article(i);
        }
        return null;
    }

    // ---------------- answers taken straight from a fact (same as data.py: take(sentences, 260, 2)) ----------------

    private static final Pattern END_OF_SENTENCE = Pattern.compile("[.!?](?=\\s+[A-Z0-9\"'(])");
    private static final Pattern ABBREV = Pattern.compile("(?:\\b[A-Z]|\\bMr|\\bMrs|\\bMs|\\bDr|\\bSt|\\bJr|\\bSr|\\bMt|\\bNo|\\bvs|\\betc|\\be\\.g|\\bi\\.e|\\bc|\\bca|\\bU\\.S|\\bU\\.K|\\bInc|\\bLtd|\\bCo|\\bJan|\\bFeb|\\bAug|\\bSept?|\\bOct|\\bNov|\\bDec|\\bapprox|\\bfl|\\bb|\\bd)\\.$");

    static List<String> sentences(String p) {
        List<String> out = new ArrayList<>();
        int start = 0;
        Matcher m = END_OF_SENTENCE.matcher(p);
        while (m.find()) {
            String chunk = p.substring(start, m.end());
            if (ABBREV.matcher(chunk).find()) continue;
            out.add(chunk.trim());
            start = m.end();
        }
        String rest = p.substring(start).trim();
        if (!rest.isEmpty()) out.add(rest);
        return out;
    }

    static String answerFrom(String fact) {
        String out = "";
        List<String> s = sentences(fact);
        for (int i = 0; i < s.size() && i < 2; i++) {
            if (!out.isEmpty() && out.length() + 1 + s.get(i).length() > 260) break;
            out = (out + " " + s.get(i)).trim();
        }
        if (out.length() > 380) {
            String cut = out.substring(0, 260);
            out = cut.substring(0, Math.max(1, cut.lastIndexOf(' '))).replaceAll("[,;:]+$", "") + ".";
        }
        return out;
    }

    /** True when the brain's answer sticks to the fact (most of its words come from it). */
    static boolean agrees(String answer, String fact) {
        Set<String> fw = new HashSet<>();
        for (String w : normKey(fact).split(" ")) fw.add(w);
        String[] aw = normKey(answer).split(" ");
        if (aw.length < 4) return false;
        int hit = 0;
        for (String w : aw) if (fw.contains(w)) hit++;
        return hit >= 0.8 * aw.length;
    }
}
