package com.kaivra.app;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Kaivra's own voice, written from scratch: text -> words -> speech sounds (ARPAbet phonemes) -> timing and
 * melody -> a formant synthesizer (a simulated voice source and vocal tract) -> 16 kHz audio.
 * No speech engine is used. Pronunciations come from the CMU Pronouncing Dictionary when it is present
 * (Carnegie Mellon University, BSD licence), from a small built-in list, and from Kaivra's own spelling rules.
 */
final class KaivraVoice {
    static final int SR = 16000;
    private static final int FRAME = 80; // 5 ms
    private static final float FMS = 5f;

    // ---------------- voices ----------------

    static final String[] VOICE_NAMES = {"Kaivra", "Kaivra deep", "Kaivra bright", "Kaivra soft"};
    // base pitch (Hz), formant scale, speed, breathiness
    private static final float[][] VOICES = {{112, 1.00f, 1.00f, 0.04f}, {92, 0.95f, 0.94f, 0.03f}, {190, 1.16f, 1.02f, 0.07f}, {160, 1.10f, 0.90f, 0.12f}};
    private int voice = 0;

    void setVoice(int v) { voice = Math.floorMod(v, VOICES.length); }
    int voice() { return voice; }

    // ---------------- speech sounds ----------------

    private static final int VOWEL = 0, GLIDE = 1, NASAL = 2, FRIC = 3, STOP = 4, AFFR = 5, ASP = 6, FLAP = 7;

    private static final class Ph {
        final String name; final int kind; final boolean voiced;
        float f1, f2, f3, e1, e2, e3, b1, b2, b3, dur, av, zero;
        float[] par; // parallel (noise) branch levels in dB: A2 A3 A4 A5 A6 AB
        Ph(String name, int kind, boolean voiced, float f1, float f2, float f3, float e1, float e2, float e3,
           float b1, float b2, float b3, float dur, float av, float zero, float[] par) {
            this.name = name; this.kind = kind; this.voiced = voiced; this.f1 = f1; this.f2 = f2; this.f3 = f3;
            this.e1 = e1; this.e2 = e2; this.e3 = e3; this.b1 = b1; this.b2 = b2; this.b3 = b3; this.dur = dur; this.av = av;
            this.zero = zero; this.par = par;
        }
    }

    private static final HashMap<String, Ph> PH = new HashMap<>();

    private static void vowel(String n, float f1, float f2, float f3, float b1, float b2, float b3, float dur) {
        PH.put(n, new Ph(n, VOWEL, true, f1, f2, f3, f1, f2, f3, b1, b2, b3, dur, 1f, 0, null));
    }

    private static void diph(String n, float f1, float f2, float f3, float e1, float e2, float e3, float dur) {
        PH.put(n, new Ph(n, VOWEL, true, f1, f2, f3, e1, e2, e3, 80, 90, 150, dur, 1f, 0, null));
    }

    private static void cons(String n, int kind, boolean voiced, float f1, float f2, float f3, float b1, float b2, float b3,
                             float dur, float av, float zero, float... par) {
        PH.put(n, new Ph(n, kind, voiced, f1, f2, f3, f1, f2, f3, b1, b2, b3, dur, av, zero, par.length == 0 ? null : par));
    }

    static {
        vowel("IY", 300, 2250, 2950, 50, 120, 200, 150);
        vowel("IH", 400, 1900, 2550, 60, 100, 150, 115);
        vowel("EH", 550, 1750, 2500, 70, 100, 160, 135);
        vowel("AE", 680, 1650, 2450, 80, 110, 170, 190);
        vowel("AA", 720, 1150, 2550, 100, 80, 150, 200);
        vowel("AO", 600, 900, 2500, 90, 80, 130, 200);
        vowel("UH", 450, 1100, 2350, 80, 100, 130, 135);
        vowel("UW", 330, 1150, 2250, 60, 100, 140, 165);
        vowel("AH", 620, 1250, 2550, 80, 80, 150, 125);
        vowel("AX", 500, 1450, 2450, 100, 110, 160, 70);
        vowel("ER", 480, 1350, 1650, 100, 80, 120, 165);
        vowel("AXR", 480, 1400, 1750, 100, 90, 130, 100);
        diph("EY", 500, 1850, 2550, 350, 2150, 2650, 175);
        diph("AY", 700, 1200, 2550, 400, 1950, 2550, 215);
        diph("AW", 700, 1250, 2550, 450, 900, 2350, 225);
        diph("OY", 560, 900, 2450, 380, 1850, 2500, 235);
        diph("OW", 560, 1000, 2400, 420, 850, 2350, 185);
        cons("W", GLIDE, true, 300, 650, 2200, 60, 80, 150, 70, 0.757f, 0);
        cons("Y", GLIDE, true, 270, 2150, 2950, 50, 150, 250, 59.13f, 0.8f, 0);
        cons("R", GLIDE, true, 330, 1100, 1450, 70, 100, 120, 70, 0.8f, 0);
        cons("L", GLIDE, true, 330, 1050, 2750, 60, 120, 250, 70, 0.8f, 0);
        cons("M", NASAL, true, 450, 1000, 2200, 100, 200, 250, 75, 0.5f, 488.7f);
        cons("N", NASAL, true, 450, 1650, 2600, 100, 250, 300, 65, 0.5f, 442.935f);
        cons("NG", NASAL, true, 450, 2050, 2600, 100, 250, 300, 85, 0.5f, 457.65f);
        //                                                                 A2   A3   A4   A5   A6   AB
        cons("F", FRIC, false, 340, 1100, 2200, 100, 120, 200, 100, 0, 0, -99, -99, -99, -99, 47, 46);
        cons("TH", FRIC, false, 320, 1400, 2600, 100, 120, 200, 90, 0, 0, -99, -99, -99, 34, 40, 34);
        cons("S", FRIC, false, 320, 1700, 2600, 100, 120, 200, 110, 0, 0, -99, -99, -99, 50, 66, -99);
        cons("SH", FRIC, false, 320, 1850, 2400, 100, 120, 200, 128.88f, 0, 0, -99, 71, 67, 62, 54, -99);
        cons("V", FRIC, true, 340, 1100, 2200, 100, 120, 200, 65, 0.149f, 0, -99, -99, -99, -99, 36, 35);
        cons("DH", FRIC, true, 320, 1400, 2600, 100, 120, 200, 50, 0.25f, 0, -99, -99, -99, 30, 34, 25);
        cons("Z", FRIC, true, 320, 1700, 2600, 100, 120, 200, 85, 0.2f, 0, -99, -99, -99, 47, 61, -99);
        cons("ZH", FRIC, true, 320, 1850, 2400, 100, 120, 200, 80, 0.2f, 0, -99, 63.917f, 59.917f, 54.917f, 48.917f, -99);
        cons("HH", ASP, false, 500, 1500, 2500, 200, 200, 250, 70, 0, 0);
        cons("P", STOP, false, 220, 850, 2200, 100, 120, 200, 85, 0, 0, -99, -99, -99, -99, 45.691f, 55.691f);
        cons("B", STOP, true, 220, 850, 2200, 100, 120, 200, 70, 0, 0, -99, -99, -99, -99, 38.22f, 48.22f);
        cons("T", STOP, false, 220, 1750, 2650, 100, 120, 200, 75.9f, 0, 0, -99, -99, 48, 56, 62, -99);
        cons("D", STOP, true, 220, 1750, 2650, 100, 120, 200, 65, 0, 0, -99, -99, 44, 52, 58, -99);
        cons("K", STOP, false, 220, 1900, 2400, 100, 120, 200, 80, 0, 0, 64, 70, 58, -99, -99, -99);
        cons("G", STOP, true, 220, 1900, 2400, 100, 120, 200, 70, 0, 0, 60, 66, 54, -99, -99, -99);
        cons("CH", AFFR, false, 220, 1850, 2400, 100, 120, 200, 140, 0, 0, -99, 68, 64, 59, 52, -99);
        cons("JH", AFFR, true, 220, 1850, 2400, 100, 120, 200, 105, 0.2f, 0, -99, 58, 54, 50, 44, -99);
        cons("DX", FLAP, true, 300, 1700, 2600, 80, 120, 200, 30, 0.5f, 0);
    }

    // ---------------- pronunciations ----------------

    private final HashMap<String, String> dict = new HashMap<>(140000);
    private volatile boolean dictReady = false;

    private static final String BUILT_IN =
        "a AH0|i AY1|am AE1 M|an AE1 N|and AH0 N D|are AA1 R|as AE1 Z|at AE1 T|be B IY1|but B AH1 T|by B AY1|can K AE1 N|" +
        "cannot K AE1 N AA0 T|do D UW1|does D AH1 Z|did D IH1 D|for F AO1 R|from F R AH1 M|get G EH1 T|go G OW1|good G UH1 D|" +
        "had HH AE1 D|has HH AE1 Z|have HH AE1 V|he HH IY1|hello HH AH0 L OW1|help HH EH1 L P|her HH ER1|here HH IY1 R|hi HH AY1|" +
        "his HH IH1 Z|how HH AW1|if IH1 F|in IH1 N|is IH1 Z|it IH1 T|its IH1 T S|it's IH1 T S|just JH AH1 S T|kaivra K AY1 V R AA2|" +
        "kaivra's K AY1 V R AA2 Z|know N OW1|like L AY1 K|live L IH1 V|me M IY1|my M AY1|no N OW1|not N AA1 T|now N AW1|of AH1 V|" +
        "on AA1 N|one W AH1 N|only OW1 N L IY0|or AO1 R|our AW1 ER0|out AW1 T|personal P ER1 S AH0 N AH0 L|" +
        "assistant AH0 S IH1 S T AH0 N T|phone F OW1 N|please P L IY1 Z|say S EY1|she SH IY1|so S OW1|some S AH1 M|" +
        "that DH AE1 T|the DH AH0|their DH EH1 R|them DH EH1 M|then DH EH1 N|there DH EH1 R|these DH IY1 Z|they DH EY1|" +
        "this DH IH1 S|those DH OW1 Z|time T AY1 M|to T UW1|today T AH0 D EY1|up AH1 P|us AH1 S|was W AA1 Z|we W IY1|" +
        "what W AH1 T|when W EH1 N|where W EH1 R|which W IH1 CH|who HH UW1|why W AY1|will W IH1 L|with W IH1 DH|you Y UW1|" +
        "your Y AO1 R|yes Y EH1 S|online AA1 N L AY2 N|standing S T AE1 N D IH0 NG|answer AE1 N S ER0|percent P ER0 S EH1 N T|" +
        "battery B AE1 T ER0 IY0|voice V OY1 S|opening OW1 P AH0 N IH0 NG|calling K AO1 L IH0 NG|welcome W EH1 L K AH0 M|" +
        "thank TH AE1 NG K|thanks TH AE1 NG K S|sorry S AA1 R IY0|okay OW2 K EY1|ok OW2 K EY1|brain B R EY1 N|" +
        "learning L ER1 N IH0 NG|still S T IH1 L|night N AY1 T|every EH1 V R IY0|little L IH1 T AH0 L|smarter S M AA1 R T ER0|" +
        "built B IH1 L T|scratch S K R AE1 CH|designed D IH0 Z AY1 N D|trained T R EY1 N D|listening L IH1 S AH0 N IH0 NG|" +
        "muted M Y UW1 T IH0 D|zero Z IH1 R OW0|two T UW1|three TH R IY1|four F AO1 R|five F AY1 V|six S IH1 K S|" +
        "seven S EH1 V AH0 N|eight EY1 T|nine N AY1 N|ten T EH1 N|eleven IH0 L EH1 V AH0 N|twelve T W EH1 L V|" +
        "thirteen TH ER1 T IY1 N|fourteen F AO1 R T IY1 N|fifteen F IH0 F T IY1 N|sixteen S IH0 K S T IY1 N|" +
        "seventeen S EH1 V AH0 N T IY1 N|eighteen EY0 T IY1 N|nineteen N AY1 N T IY1 N|twenty T W EH1 N T IY0|" +
        "thirty TH ER1 D IY0|forty F AO1 R T IY0|fifty F IH1 F T IY0|sixty S IH1 K S T IY0|seventy S EH1 V AH0 N T IY0|" +
        "eighty EY1 T IY0|ninety N AY1 N T IY0|hundred HH AH1 N D R AH0 D|thousand TH AW1 Z AH0 N D|million M IH1 L Y AH0 N|" +
        "billion B IH1 L Y AH0 N|point P OY1 N T|minus M AY1 N AH0 S|oh OW1|first F ER1 S T|second S EH1 K AH0 N D|" +
        "third TH ER1 D|fifth F IH1 F TH|monday M AH1 N D EY2|tuesday T UW1 Z D EY2|wednesday W EH1 N Z D EY2|" +
        "thursday TH ER1 Z D EY2|friday F R AY1 D EY2|saturday S AE1 T ER0 D EY2|sunday S AH1 N D EY2|" +
        "january JH AE1 N Y UW0 EH2 R IY0|february F EH1 B Y AH0 W EH2 R IY0|march M AA1 R CH|april EY1 P R AH0 L|may M EY1|" +
        "june JH UW1 N|july JH UW0 L AY1|august AO1 G AH0 S T|september S EH0 P T EH1 M B ER0|october AA0 K T OW1 B ER0|" +
        "november N OW0 V EH1 M B ER0|december D IH0 S EH1 M B ER0|torch T AO1 R CH|screenshot S K R IY1 N SH AA2 T|" +
        "notifications N OW2 T AH0 F AH0 K EY1 SH AH0 N Z|settings S EH1 T IH0 NG Z|library L AY1 B R EH2 R IY0|" +
        "knowledge N AA1 L IH0 JH|offline AO1 F L AY2 N|github G IH1 T HH AH2 B|mushroom M AH1 SH R UW2 M";

    private static final String[] LETTERS = {"EY1", "B IY1", "S IY1", "D IY1", "IY1", "EH1 F", "JH IY1", "EY1 CH", "AY1", "JH EY1",
        "K EY1", "EH1 L", "EH1 M", "EH1 N", "OW1", "P IY1", "K Y UW1", "AA1 R", "EH1 S", "T IY1", "Y UW1", "V IY1",
        "D AH1 B AH0 L Y UW0", "EH1 K S", "W AY1", "Z IY1"};

    KaivraVoice() {
        for (String e : BUILT_IN.split("\\|")) {
            int sp = e.indexOf(' ');
            dict.put(e.substring(0, sp), e.substring(sp + 1));
        }
    }

    /** Loads the CMU Pronouncing Dictionary (cmudict.dict format). Call on a background thread. */
    void loadDictionary(InputStream in) throws IOException {
        HashMap<String, String> d = new HashMap<>(140000);
        try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8), 1 << 16)) {
            for (String line; (line = r.readLine()) != null; ) {
                int sp = line.indexOf(' ');
                if (sp <= 0) continue;
                String w = line.substring(0, sp);
                if (w.indexOf('(') >= 0) continue; // alternative pronunciations
                int hash = line.indexOf('#');
                String p = (hash > 0 ? line.substring(sp + 1, hash) : line.substring(sp + 1)).trim();
                d.put(w, p);
            }
        }
        synchronized (dict) {
            for (java.util.Map.Entry<String, String> e : d.entrySet()) dict.putIfAbsent(e.getKey(), e.getValue());
        }
        dictReady = true;
    }

    boolean dictionaryReady() { return dictReady; }

    private String lookup(String w) {
        synchronized (dict) { return dict.get(w); }
    }

    // ---------------- text -> words ----------------

    private static final String[] ONES = {"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"};
    private static final String[] TENS = {"", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"};

    static String number(long n) {
        if (n < 0) return "minus " + number(-n);
        if (n < 20) return ONES[(int) n];
        if (n < 100) return TENS[(int) (n / 10)] + (n % 10 != 0 ? " " + ONES[(int) (n % 10)] : "");
        if (n < 1000) return ONES[(int) (n / 100)] + " hundred" + (n % 100 != 0 ? " and " + number(n % 100) : "");
        String[] names = {"thousand", "million", "billion", "trillion"};
        long[] sizes = {1000L, 1000000L, 1000000000L, 1000000000000L};
        for (int i = sizes.length - 1; i >= 0; i--) {
            if (n >= sizes[i]) {
                long hi = n / sizes[i], lo = n % sizes[i];
                return number(hi) + " " + names[i] + (lo == 0 ? "" : (lo < 100 ? " and " : " ") + number(lo));
            }
        }
        return Long.toString(n);
    }

    static String year(int y) {
        if (y >= 2000 && y < 2010) return number(y);
        int hi = y / 100, lo = y % 100;
        return number(hi) + (lo == 0 ? " hundred" : lo < 10 ? " oh " + ONES[lo] : " " + number(lo));
    }

    static String ordinal(long n) {
        String w = number(n);
        String[][] irregular = {{"one", "first"}, {"two", "second"}, {"three", "third"}, {"five", "fifth"}, {"eight", "eighth"},
            {"nine", "ninth"}, {"twelve", "twelfth"}};
        for (String[] ir : irregular) if (w.endsWith(ir[0])) return w.substring(0, w.length() - ir[0].length()) + ir[1];
        if (w.endsWith("y")) return w.substring(0, w.length() - 1) + "ieth";
        return w + "th";
    }

    private static final Pattern TIME = Pattern.compile("\\b(\\d{1,2}):(\\d{2})\\b");
    private static final Pattern ORD = Pattern.compile("\\b(\\d+)(st|nd|rd|th)\\b");
    private static final Pattern DEC = Pattern.compile("(\\d+)\\.(\\d+)");
    private static final Pattern NUM = Pattern.compile("\\d+");
    private static final Pattern ACRONYM = Pattern.compile("\\b([A-Z]{2,5})s?\\b");

    static String normalize(String text) {
        String t = " " + text.replace('’', '\'').replace('‘', '\'').replace('“', '"').replace('”', '"') + " ";
        t = t.replace("&", " and ").replace("%", " percent ").replace("+", " plus ").replace("=", " equals ")
            .replace("°C", " degrees Celsius").replace("°", " degrees ");
        t = t.replaceAll("\\bDr\\.", "doctor").replaceAll("\\bMr\\.", "mister").replaceAll("\\bMrs\\.", "missus")
            .replaceAll("\\bSt\\.", "saint").replaceAll("\\be\\.g\\.", "for example").replaceAll("\\bi\\.e\\.", "that is")
            .replaceAll("\\betc\\.", "et cetera").replaceAll("\\bvs\\.?\\b", "versus").replaceAll("\\bkm\\b", "kilometres")
            .replaceAll("\\bkg\\b", "kilograms").replaceAll("\\bcm\\b", "centimetres").replaceAll("\\bmm\\b", "millimetres")
            .replaceAll("\\bOK\\b", "okay").replaceAll("\\bc\\. (\\d)", "about $1");
        Matcher m = TIME.matcher(t);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            int h = Integer.parseInt(m.group(1)), mi = Integer.parseInt(m.group(2));
            String w = number(h) + (mi == 0 ? "" : mi < 10 ? " oh " + ONES[mi] : " " + number(mi));
            m.appendReplacement(sb, w);
        }
        m.appendTail(sb);
        t = sb.toString();
        m = ORD.matcher(t);
        sb = new StringBuffer();
        while (m.find()) m.appendReplacement(sb, ordinal(Long.parseLong(m.group(1))));
        m.appendTail(sb);
        t = sb.toString();
        m = DEC.matcher(t);
        sb = new StringBuffer();
        while (m.find()) {
            StringBuilder w = new StringBuilder(numberWords(m.group(1), false)).append(" point");
            for (char c : m.group(2).toCharArray()) w.append(' ').append(ONES[c - '0']);
            m.appendReplacement(sb, w.toString());
        }
        m.appendTail(sb);
        t = sb.toString();
        m = NUM.matcher(t);
        sb = new StringBuffer();
        while (m.find()) {
            boolean yearLike = m.group().length() == 4 && !t.substring(m.end()).matches("(?s)^\\s*(percent|people|kilo|metres|million|thousand).*");
            m.appendReplacement(sb, " " + numberWords(m.group(), yearLike) + " ");
        }
        m.appendTail(sb);
        t = sb.toString();
        m = ACRONYM.matcher(t);
        sb = new StringBuffer();
        while (m.find()) {
            String a = m.group(1);
            if (a.equals("AM") || a.equals("PM") || a.length() <= 4) {
                StringBuilder w = new StringBuilder();
                for (char c : a.toCharArray()) w.append(' ').append(Character.toLowerCase(c)).append('_');
                m.appendReplacement(sb, w.toString() + (m.group().endsWith("s") ? "z_" : "") + " ");
            } else m.appendReplacement(sb, m.group());
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static String numberWords(String digits, boolean yearLike) {
        if (digits.length() > 15) {
            StringBuilder w = new StringBuilder();
            for (char c : digits.toCharArray()) w.append(ONES[c - '0']).append(' ');
            return w.toString().trim();
        }
        long n = Long.parseLong(digits);
        if (yearLike && n >= 1100 && n <= 2099 && !(n >= 2000 && n < 2010)) return year((int) n);
        if (digits.length() > 1 && digits.startsWith("0")) {
            StringBuilder w = new StringBuilder();
            for (char c : digits.toCharArray()) w.append(c == '0' ? "oh" : ONES[c - '0']).append(' ');
            return w.toString().trim();
        }
        return number(n);
    }

    // ---------------- words -> phonemes ----------------

    private static final java.util.Set<String> FUNCTION_WORDS = new java.util.HashSet<>(java.util.Arrays.asList(
        "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "by", "from", "is", "am", "are",
        "was", "were", "be", "been", "it", "its", "it's", "i", "i'm", "you", "your", "my", "me", "we", "he", "she", "they",
        "them", "his", "her", "our", "this", "that", "can", "will", "do", "does", "did", "have", "has", "had", "so", "as",
        "if", "than", "then", "there", "just", "up", "out", "into", "about", "would", "could", "should", "what", "how"));

    private static final class Seg {
        Ph ph; int stress = -1; float dur; float pause; boolean wordStart; int phrase; boolean question; boolean function;
        int start, n; // frames
        int burstF, votF; // stops: release burst and aspiration, in frames
        Seg(Ph ph) { this.ph = ph; }
    }

    private List<String> phonesFor(String word) {
        List<String> out = new ArrayList<>();
        if (word.endsWith("_") && word.length() == 2) { // a spelled letter
            char c = word.charAt(0);
            if (c >= 'a' && c <= 'z') for (String p : LETTERS[c - 'a'].split(" ")) out.add(p);
            return out;
        }
        if (word.equals("z_")) { out.add("Z"); return out; }
        String p = lookup(word);
        if (p == null && word.endsWith("'s")) {
            String base = lookup(word.substring(0, word.length() - 2));
            if (base != null) {
                String last = base.substring(base.lastIndexOf(' ') + 1);
                p = base + (last.matches("[PTKFTH]+") ? " S" : " Z");
            }
        }
        if (p == null) p = Rules.spell(word.replace("'", ""));
        for (String s : p.split(" ")) if (!s.isEmpty()) out.add(s);
        return out;
    }

    private List<Seg> segments(String text) {
        String norm = normalize(text);
        List<Seg> segs = new ArrayList<>();
        Pattern tok = Pattern.compile("[A-Za-zÀ-ɏ]+(?:'[A-Za-z]+)?_?|[.,;:!?—–()\"-]");
        Matcher m = tok.matcher(norm);
        int phrase = 0;
        List<Seg> phraseSegs = new ArrayList<>();
        while (m.find()) {
            String w = m.group();
            char c0 = w.charAt(0);
            if (!Character.isLetter(c0)) {
                float pause;
                switch (c0) {
                    case ',': case '(': case ')': case '"': case '-': pause = PAUSE_COMMA; break;
                    case ';': case ':': case '—': case '–': pause = PAUSE_COLON; break;
                    default: pause = PAUSE_END;
                }
                if (c0 == '-' || c0 == '"') continue;
                Seg s = new Seg(null);
                s.pause = pause;
                s.phrase = phrase;
                if (c0 == '?') for (Seg q : phraseSegs) q.question = true;
                segs.add(s);
                phrase++;
                phraseSegs.clear();
                continue;
            }
            String word = Normalizer2.fold(w.toLowerCase(Locale.ROOT));
            List<String> ps = phonesFor(word);
            boolean function = FUNCTION_WORDS.contains(word);
            boolean first = true;
            for (String p : ps) {
                int stress = -1;
                char last = p.charAt(p.length() - 1);
                String base = p;
                if (last >= '0' && last <= '2') { stress = last - '0'; base = p.substring(0, p.length() - 1); }
                if (function && stress > 0) stress = 0;
                if (base.equals("AH") && stress == 0) base = "AX";
                if (base.equals("ER") && stress == 0) base = "AXR";
                Ph ph = PH.get(base);
                if (ph == null) continue;
                Seg s = new Seg(ph);
                s.stress = stress;
                s.function = function;
                s.wordStart = first;
                s.phrase = phrase;
                first = false;
                segs.add(s);
                phraseSegs.add(s);
            }
        }
        return segs;
    }

    // ---------------- timing and melody ----------------

    private void timing(List<Seg> segs, float speed) {
        for (int i = 0; i < segs.size(); i++) {
            Seg s = segs.get(i);
            if (s.ph == null) { s.dur = s.pause; continue; }
            float d = s.ph.dur;
            if (s.ph.kind == VOWEL) {
                d *= s.stress == 1 ? V_STRESS1 : s.stress == 2 ? V_STRESS2 : V_STRESS0;
                if (s.ph.e2 != s.ph.f2) d *= 1.1f; // glides need time to move
                // the last vowel before a pause is longer
                boolean finalV = true;
                for (int j = i + 1; j < segs.size(); j++) {
                    Seg t = segs.get(j);
                    if (t.ph == null) break;
                    if (t.ph.kind == VOWEL) { finalV = false; break; }
                }
                if (finalV) d *= FINAL_LEN;
            } else if (s.ph.kind == STOP) {
                stopTiming(segs, i, speed);
                continue;
            } else {
                Seg prev = i > 0 ? segs.get(i - 1) : null, next = i + 1 < segs.size() ? segs.get(i + 1) : null;
                boolean cluster = (prev != null && prev.ph != null && prev.ph.kind != VOWEL) || (next != null && next.ph != null && next.ph.kind != VOWEL);
                d *= CONS_LEN;
                if (cluster) d *= CLUSTER;
                if (s.function) d *= 0.85f;
                if (next == null || next.ph == null) d *= 1.15f;
            }
            s.dur = Math.max(s.ph.kind == VOWEL ? 40f : 20f, d / speed);
        }
    }

    /** A stop is a closure, a short burst and (for p, t, k before a vowel) a puff of breath before the voice starts. */
    private void stopTiming(List<Seg> segs, int i, float speed) {
        Seg s = segs.get(i);
        Seg prev = i > 0 ? segs.get(i - 1) : null;
        Seg next = i + 1 < segs.size() ? segs.get(i + 1) : null;
        if (next != null && next.ph == null) next = null;
        char place = "PB".contains(s.ph.name) ? 'L' : "TD".contains(s.ph.name) ? 'A' : 'V';
        s.burstF = Math.max(1, (place == 'L' ? 2 : place == 'A' ? 3 : 5) - (s.ph.voiced ? 1 : 0) + BURST_FRAMES - 2);
        int vot = 0;
        boolean afterS = prev != null && prev.ph != null && prev.ph.name.equals("S");
        if (next == null) vot = s.ph.voiced ? 0 : 2;
        else if (next.ph.kind == VOWEL || next.ph.kind == GLIDE) {
            if (s.ph.voiced) vot = 1;
            else if (afterS) vot = 2;
            else {
                Seg v = next;
                if (next.ph.kind == GLIDE && i + 2 < segs.size() && segs.get(i + 2).ph != null) v = segs.get(i + 2);
                vot = (v.stress >= 1 ? VOT_STRESSED : VOT_UNSTRESSED) + (place == 'V' ? 1 : place == 'L' ? -1 : 0);
            }
        }
        s.votF = Math.max(0, vot);
        float closure = s.ph.dur * CLOSURE_LEN;
        boolean cluster = (prev != null && prev.ph != null && prev.ph.kind != VOWEL) || (next != null && next.ph.kind != VOWEL && next.ph.kind != GLIDE);
        if (cluster) closure *= CLUSTER;
        if (s.function) closure *= 0.85f;
        closure = Math.max(25f, closure / speed);
        s.dur = closure + (s.burstF + s.votF) * FMS;
    }

    /** American English taps t and d between a stressed and an unstressed vowel, as in water, better, city. */
    private static void flaps(List<Seg> segs) {
        for (int i = 1; i + 1 < segs.size(); i++) {
            Seg s = segs.get(i), a = segs.get(i - 1), b = segs.get(i + 1);
            if (s.ph == null || a.ph == null || b.ph == null) continue;
            if (!(s.ph.name.equals("T") || s.ph.name.equals("D"))) continue;
            boolean before = a.ph.kind == VOWEL && a.stress >= 1 || a.ph.name.equals("R");
            boolean after = b.ph.kind == VOWEL && b.stress <= 0;
            if (before && after) s.ph = PH.get("DX");
        }
    }

    // ---------------- the synthesizer ----------------

    private static final class Res {
        double a, b, c, y1, y2;
        void set(double f, double bw) {
            f = Math.min(f, SR * 0.48);
            double r = Math.exp(-Math.PI * bw / SR);
            c = -r * r;
            b = 2 * r * Math.cos(2 * Math.PI * f / SR);
            a = 1 - b - c;
        }
        double run(double x) { double y = a * x + b * y1 + c * y2; y2 = y1; y1 = y; return y; }
    }

    /** Band-pass resonator with a peak gain of 1 and no response at 0 Hz: for the noise (hissing) branch. */
    private static final class BandPass {
        double g, b, c, x1, x2, y1, y2;
        void set(double f, double bw) {
            f = Math.min(f, SR * 0.48);
            double r = Math.exp(-Math.PI * bw / SR);
            c = -r * r;
            b = 2 * r * Math.cos(2 * Math.PI * f / SR);
            g = (1 - r * r) / 2;
        }
        double run(double x) { double y = g * (x - x2) + b * y1 + c * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; }
    }

    private static final class AntiRes {
        double a, b, c, x1, x2;
        void set(double f, double bw) {
            double r = Math.exp(-Math.PI * bw / SR);
            double cc = -r * r, bb = 2 * r * Math.cos(2 * Math.PI * f / SR), aa = 1 - bb - cc;
            a = 1 / aa; b = -bb / aa; c = -cc / aa;
        }
        double run(double x) { double y = a * x + b * x1 + c * x2; x2 = x1; x1 = x; return y; }
    }

    // ---------------- tunable settings (tuned with the listening test in brain/voice) ----------------
    static double PAR_GAIN = 0.3, TILT = 0.525, OQ = 0.6, BURST_GAIN = 1.421, ASP_AH = 0.819, HH_AH = 0.482, VOICE_BAR = 0.12;
    static int VOT_STRESSED = 11, VOT_UNSTRESSED = 9, BURST_FRAMES = 2, SMOOTH_F1 = 4, SMOOTH_F23 = 5, SMOOTH_AV = 2, NASAL_SPREAD = 4, ONSET_RAMP = 5;
    static float V_STRESS1 = 0.72f, V_STRESS2 = 0.6f, V_STRESS0 = 0.45f, FINAL_LEN = 1.3f, CONS_LEN = 0.798f, CLUSTER = 0.85f;
    static float PAUSE_COMMA = 110, PAUSE_COLON = 170, PAUSE_END = 260, ACCENT_FIRST = 1.1f, ACCENT_LAST = 1.07f, DECLINE = 0.12f;
    static float F4 = 3350, F5 = 3850, NASAL_ZERO_BW = 78.98f, PITCH = 0, SPEED = 0, CLOSURE_LEN = 0.75f;

    /**
     * Changes settings from text, one per line: "global.NAME = value" or "PHONEME.field = values"
     * (fields: f, e, b = three formants; f1, f2, f3 = one formant; dur, av, zero; par = A2 A3 A4 A5 A6 AB in dB). "*=" multiplies and "+=" adds
     * (one value applies to every entry; silent par entries stay silent). Used by the listening test and the tuner.
     */
    static void tune(String spec) {
        for (String raw : spec.split("\n")) {
            String line = raw.trim();
            int hash = line.indexOf('#');
            if (hash >= 0) line = line.substring(0, hash).trim();
            int eq = line.indexOf('=');
            if (eq < 0) continue;
            String key = line.substring(0, eq).trim();
            char op = '=';
            if (key.endsWith("*") || key.endsWith("+")) { op = key.charAt(key.length() - 1); key = key.substring(0, key.length() - 1).trim(); }
            String[] v = line.substring(eq + 1).trim().split("[\\s,]+");
            int dot = key.indexOf('.');
            if (dot < 0) continue;
            String who = key.substring(0, dot), field = key.substring(dot + 1);
            try {
                double x0 = Double.parseDouble(v[0]);
                if (who.equals("global")) {
                    java.lang.reflect.Field f = KaivraVoice.class.getDeclaredField(field);
                    if (f.getType() == double.class) f.setDouble(null, apply(op, f.getDouble(null), x0));
                    else if (f.getType() == int.class) f.setInt(null, (int) Math.round(apply(op, f.getInt(null), x0)));
                    else f.setFloat(null, (float) apply(op, f.getFloat(null), x0));
                    continue;
                }
                Ph ph = PH.get(who);
                if (ph == null) continue;
                float[] x = new float[v.length];
                for (int i = 0; i < v.length; i++) x[i] = Float.parseFloat(v[i]);
                switch (field) {
                    case "f": {
                        boolean steady = ph.e1 == ph.f1 && ph.e2 == ph.f2 && ph.e3 == ph.f3;
                        ph.f1 = vec(op, ph.f1, x, 0); ph.f2 = vec(op, ph.f2, x, 1); ph.f3 = vec(op, ph.f3, x, 2);
                        if (steady) { ph.e1 = ph.f1; ph.e2 = ph.f2; ph.e3 = ph.f3; }
                        break;
                    }
                    case "e": ph.e1 = vec(op, ph.e1, x, 0); ph.e2 = vec(op, ph.e2, x, 1); ph.e3 = vec(op, ph.e3, x, 2); break;
                    case "b": ph.b1 = vec(op, ph.b1, x, 0); ph.b2 = vec(op, ph.b2, x, 1); ph.b3 = vec(op, ph.b3, x, 2); break;
                    case "f1": case "f2": case "f3": {
                        int k = field.charAt(1) - '1';
                        boolean steady = ph.e1 == ph.f1 && ph.e2 == ph.f2 && ph.e3 == ph.f3;
                        if (k == 0) ph.f1 = (float) apply(op, ph.f1, x[0]); else if (k == 1) ph.f2 = (float) apply(op, ph.f2, x[0]); else ph.f3 = (float) apply(op, ph.f3, x[0]);
                        if (steady) { ph.e1 = ph.f1; ph.e2 = ph.f2; ph.e3 = ph.f3; }
                        break;
                    }
                    case "dur": ph.dur = (float) apply(op, ph.dur, x[0]); break;
                    case "av": ph.av = (float) apply(op, ph.av, x[0]); break;
                    case "zero": ph.zero = (float) apply(op, ph.zero, x[0]); break;
                    case "par":
                        if (op == '=') ph.par = x;
                        else if (ph.par != null) for (int k = 0; k < ph.par.length; k++) if (ph.par[k] > -90) ph.par[k] = vec(op, ph.par[k], x, k);
                        break;
                    default: break;
                }
            } catch (Exception e) {
                // ignore a bad line
            }
        }
    }

    private static double apply(char op, double cur, double x) { return op == '*' ? cur * x : op == '+' ? cur + x : x; }

    private static float vec(char op, float cur, float[] x, int i) { return (float) apply(op, cur, x[Math.min(i, x.length - 1)]); }

    /** All settings as tune() text (absolute values), for saving the result of tuning. */
    static String settings() {
        StringBuilder b = new StringBuilder();
        for (java.lang.reflect.Field f : KaivraVoice.class.getDeclaredFields()) {
            int m = f.getModifiers();
            if (!java.lang.reflect.Modifier.isStatic(m) || java.lang.reflect.Modifier.isFinal(m)) continue;
            Class<?> t = f.getType();
            if (t != double.class && t != int.class && t != float.class) continue;
            try { b.append("global.").append(f.getName()).append(" = ").append(f.get(null)).append('\n'); } catch (Exception e) { /* skip */ }
        }
        java.util.TreeMap<String, Ph> sorted = new java.util.TreeMap<>(PH);
        for (Ph p : sorted.values()) {
            String n = p.name;
            b.append(n).append(".f = ").append(p.f1).append(' ').append(p.f2).append(' ').append(p.f3).append('\n');
            if (p.e1 != p.f1 || p.e2 != p.f2 || p.e3 != p.f3) b.append(n).append(".e = ").append(p.e1).append(' ').append(p.e2).append(' ').append(p.e3).append('\n');
            b.append(n).append(".b = ").append(p.b1).append(' ').append(p.b2).append(' ').append(p.b3).append('\n');
            b.append(n).append(".dur = ").append(p.dur).append('\n').append(n).append(".av = ").append(p.av).append('\n');
            if (p.zero != 0) b.append(n).append(".zero = ").append(p.zero).append('\n');
            if (p.par != null) {
                b.append(n).append(".par =");
                for (float q : p.par) b.append(' ').append(q);
                b.append('\n');
            }
        }
        return b.toString();
    }

    private static float db(float d) { return d <= -90 ? 0f : (float) Math.pow(10, (d - 60) / 20.0); }

    private long seed = 12345;
    private double noise() { seed = seed * 6364136223846793005L + 1442695040888963407L; return ((seed >>> 33) / (double) (1L << 31)) - 1.0; }

    /** Phoneme timing of the last synthesis (name, first 5 ms frame, frames), for checking. */
    String labels = "";

    /** Speech for the text as 16-bit PCM at 16 kHz. */
    synchronized short[] synthesize(String text) {
        float[] vp = VOICES[voice];
        float pitch = PITCH > 0 ? PITCH : vp[0], fs = vp[1], speed = SPEED > 0 ? SPEED : vp[2], breath = vp[3];
        List<Seg> segs = segments(text);
        if (segs.isEmpty()) return new short[0];
        flaps(segs);
        timing(segs, speed);
        int total = 2;
        StringBuilder lab = new StringBuilder();
        for (Seg s : segs) {
            s.start = total; s.n = Math.max(1, Math.round(s.dur / FMS)); total += s.n;
            lab.append(s.ph == null ? "_" : s.ph.name + (s.stress >= 0 ? s.stress : "")).append(' ').append(s.start).append(' ').append(s.n).append(' ').append(s.burstF).append(' ').append(s.votF).append('\n');
        }
        labels = lab.toString();
        total += 6;
        float[] F1 = new float[total], F2 = new float[total], F3 = new float[total], B1 = new float[total], B2 = new float[total], B3 = new float[total];
        float[] AV = new float[total], AH = new float[total], AF = new float[total], FZ = new float[total], F0 = new float[total];
        float[][] PAR = new float[6][total];

        // targets per frame
        Seg firstReal = null;
        for (Seg s : segs) if (s.ph != null) { firstReal = s; break; }
        if (firstReal == null) return new short[0];
        float[] lastF = {firstReal.ph.f1, firstReal.ph.f2, firstReal.ph.f3};
        for (int i = 0; i < segs.size(); i++) {
            Seg s = segs.get(i);
            Seg next = null;
            for (int j = i + 1; j < segs.size(); j++) { if (segs.get(j).ph != null) { next = segs.get(j); break; } if (segs.get(j).pause > 0) break; }
            Seg prev = i > 0 ? segs.get(i - 1) : null;
            for (int f = 0; f < s.n; f++) {
                int fr = s.start + f;
                float p = s.n > 1 ? f / (float) (s.n - 1) : 0.5f;
                FZ[fr] = 270;
                if (s.ph == null) {
                    F1[fr] = lastF[0]; F2[fr] = lastF[1]; F3[fr] = lastF[2]; B1[fr] = 90; B2[fr] = 110; B3[fr] = 170;
                    continue;
                }
                Ph ph = s.ph;
                float e = p * p * (3 - 2 * p);
                F1[fr] = ph.f1 + (ph.e1 - ph.f1) * e; F2[fr] = ph.f2 + (ph.e2 - ph.f2) * e; F3[fr] = ph.f3 + (ph.e3 - ph.f3) * e;
                B1[fr] = ph.b1; B2[fr] = ph.b2; B3[fr] = ph.b3;
                switch (ph.kind) {
                    case VOWEL:
                        AV[fr] = s.stress == 1 ? 1f : s.stress == 2 ? 0.9f : 0.72f;
                        AH[fr] = breath;
                        break;
                    case GLIDE:
                        AV[fr] = ph.av; AH[fr] = breath;
                        break;
                    case NASAL:
                        AV[fr] = ph.av; FZ[fr] = ph.zero; AH[fr] = breath;
                        break;
                    case FLAP:
                        AV[fr] = f < s.n / 2 ? 0.25f : ph.av;
                        break;
                    case ASP: {
                        Ph t = next != null ? next.ph : ph;
                        F1[fr] = t.f1; F2[fr] = t.f2; F3[fr] = t.f3; B1[fr] = 200; B2[fr] = 180; B3[fr] = 220;
                        AH[fr] = (float) HH_AH;
                        AV[fr] = (prev != null && prev.ph != null && prev.ph.kind == VOWEL && next != null && next.ph.kind == VOWEL) ? 0.15f : 0f;
                        break;
                    }
                    case FRIC:
                        AV[fr] = ph.av;
                        AF[fr] = 1f;
                        for (int k = 0; k < 6; k++) PAR[k][fr] = db(ph.par[k]);
                        break;
                    case STOP: case AFFR: {
                        int burst = ph.kind == AFFR ? Math.max(4, (int) (s.n * 0.55f)) : s.burstF;
                        int asp = ph.kind == AFFR || next == null && s.votF == 0 ? 0 : s.votF;
                        int closure = s.n - burst - asp;
                        if (closure < 1) { closure = 1; burst = Math.min(burst, s.n - 1); asp = Math.max(0, s.n - 1 - burst); }
                        if (ph.name.equals("K") || ph.name.equals("G")) {
                            float nf2 = next != null ? next.ph.f2 : 1800;
                            F2[fr] = nf2 > 1500 ? Math.min(2300, nf2 + 200) : 1400;
                            F3[fr] = nf2 > 1500 ? 2600 : 2200;
                        }
                        if (f < closure) {
                            AV[fr] = ph.voiced ? (float) VOICE_BAR : 0f;
                            F1[fr] = 200;
                        } else if (f < closure + burst) {
                            float decay = 1f - 0.5f * (f - closure) / Math.max(1, burst);
                            AF[fr] = ph.kind == AFFR ? 1f : (float) BURST_GAIN * decay;
                            for (int k = 0; k < 6; k++) PAR[k][fr] = db(ph.par[k]);
                            AV[fr] = ph.voiced ? (ph.kind == AFFR ? ph.av : 0.2f) : 0f;
                        } else {
                            Ph t = next != null ? next.ph : ph;
                            F1[fr] = t.f1; F2[fr] = t.f2; F3[fr] = t.f3;
                            AH[fr] = (float) (ph.voiced ? ASP_AH * 0.4 : ASP_AH);
                            B1[fr] = 300; B2[fr] = Math.max(B2[fr], 150);
                        }
                        break;
                    }
                }
            }
            if (s.ph != null) { lastF[0] = s.ph.e1; lastF[1] = s.ph.e2; lastF[2] = s.ph.e3; }
        }
        for (int fr = 0; fr < 2; fr++) { F1[fr] = F1[2]; F2[fr] = F2[2]; F3[fr] = F3[2]; B1[fr] = 90; B2[fr] = 110; B3[fr] = 170; }
        for (int fr = total - 6; fr < total; fr++) { F1[fr] = F1[total - 7]; F2[fr] = F2[total - 7]; F3[fr] = F3[total - 7]; B1[fr] = 90; B2[fr] = 110; B3[fr] = 170; }

        // smooth the vocal tract movements: formants slowly, loudness quickly
        F1 = smooth(F1, SMOOTH_F1); F2 = smooth(F2, SMOOTH_F23); F3 = smooth(F3, SMOOTH_F23);
        B1 = smooth(B1, 3); B2 = smooth(B2, 3); B3 = smooth(B3, 3);
        for (int i = 0; i < segs.size(); i++) {
            Seg s = segs.get(i);
            boolean afterPause = i == 0 || segs.get(i - 1).ph == null;
            if (s.ph == null || !afterPause || !(s.ph.kind == VOWEL || s.ph.kind == GLIDE || s.ph.kind == NASAL)) continue;
            for (int k = 0; k < ONSET_RAMP && k < s.n; k++) AV[s.start + k] *= (k + 1f) / (ONSET_RAMP + 1f);
        }
        AV = smooth(AV, SMOOTH_AV); AH = smooth(AH, 1);
        for (int fr = 0; fr < 2; fr++) FZ[fr] = 270;
        for (int fr = total - 6; fr < total; fr++) FZ[fr] = 270;
        FZ = smooth(FZ, NASAL_SPREAD); // nasal sound spreads into the neighbouring vowels

        // melody: a falling line per phrase, raised on stressed syllables, rising at the end of a question
        melody(segs, F0, pitch, total);

        // run the source and the filters
        float[] out = new float[total * FRAME];
        Res r1 = new Res(), r2 = new Res(), r3 = new Res(), r4 = new Res(), r5 = new Res(), rnp = new Res();
        AntiRes rnz = new AntiRes();
        BandPass p2 = new BandPass(), p3 = new BandPass(), p4 = new BandPass(), p5 = new BandPass(), p6 = new BandPass();
        double t0 = SR / pitch, ph = 0, tilt = 0, aspLp = 0, prevN = 0, dc1 = 0, dcY = 0;
        double periodAmp = 0;
        int o = 0;
        for (int fr = 0; fr < total; fr++) {
            r1.set(F1[fr] * fs, B1[fr]); r2.set(F2[fr] * fs, B2[fr]); r3.set(F3[fr] * fs, B3[fr]);
            r4.set(F4 * fs, 250); r5.set(F5 * fs, 300);
            rnp.set(270, 100);
            rnz.set(FZ[fr], 100 + (NASAL_ZERO_BW - 100) * Math.min(1f, Math.max(0f, (FZ[fr] - 270) / 180f)));
            p2.set(F2[fr] * fs, 200); p3.set(F3[fr] * fs, 250); p4.set(F4 * fs, 300); p5.set(4300 * fs, 400); p6.set(5300, 700);
            float av = AV[fr], ah = AH[fr], af = AF[fr];
            float a2 = PAR[0][fr], a3 = PAR[1][fr], a4 = PAR[2][fr], a5 = PAR[3][fr], a6 = PAR[4][fr], ab = PAR[5][fr];
            for (int i = 0; i < FRAME; i++) {
                // voice source: one glottal pulse per period (flow derivative 2x - 3x^2 over the open phase)
                if (ph >= t0) {
                    ph -= t0;
                    double f0 = Math.max(50, F0[fr]) * (1 + 0.006 * noise());
                    t0 = SR / f0;
                    periodAmp = av * (1 + 0.03 * noise());
                }
                double te = OQ * t0, g = 0;
                boolean open = ph < te;
                if (open) { double x = ph / te; g = (2 * x - 3 * x * x) * periodAmp; }
                ph += 1;
                tilt = TILT * tilt + (1 - TILT) * g;
                double n = noise();
                aspLp = 0.6 * aspLp + 0.4 * n;
                double asp = aspLp * ah * (av > 0.05 ? (open ? 1.0 : 0.4) : 1.0);
                double src = tilt * 0.9 + asp * 0.35;
                double c = r1.run(r2.run(r3.run(r4.run(r5.run(rnz.run(rnp.run(src)))))));
                // noise branch for hissing sounds and bursts
                double fn = n * af * (av > 0.1 ? (open ? 1.0 : 0.5) : 1.0);
                double d = fn - prevN;
                prevN = fn;
                double par = 0;
                if (af > 0) par = a2 * p2.run(d) - a3 * p3.run(d) + a4 * p4.run(d) - a5 * p5.run(d) + a6 * p6.run(d) + ab * d * 0.5;
                else { p2.run(0); p3.run(0); p4.run(0); p5.run(0); p6.run(0); }
                double y = c * 0.6 + par * PAR_GAIN;
                double hp = y - dc1 + 0.995 * dcY; // remove any DC
                dc1 = y;
                dcY = hp;
                out[o++] = (float) hp;
            }
        }
        // loudness: normalise and soften peaks
        double peak = 1e-9;
        for (float v : out) peak = Math.max(peak, Math.abs(v));
        double gain = 0.85 / peak;
        short[] pcm = new short[out.length];
        for (int i = 0; i < out.length; i++) {
            double v = out[i] * gain;
            v = Math.tanh(v * 1.2) / Math.tanh(1.2);
            pcm[i] = (short) Math.round(Math.max(-1, Math.min(1, v)) * 32000);
        }
        return pcm;
    }

    private static float[] smooth(float[] a, int r) {
        if (r <= 0) return a.clone();
        float[] o = new float[a.length];
        for (int i = 0; i < a.length; i++) {
            float s = 0; int n = 0;
            for (int j = Math.max(0, i - r); j <= Math.min(a.length - 1, i + r); j++) { s += a[j]; n++; }
            o[i] = s / n;
        }
        return o;
    }

    private void melody(List<Seg> segs, float[] F0, float pitch, int total) {
        // One smooth line per phrase: starts a little high, drifts down, one gentle rise on the first stressed
        // content word and one on the last (the main word), then falls at the end (or rises for a question).
        List<float[]> pts = new ArrayList<>(); // frame, Hz
        int i = 0;
        while (i < segs.size()) {
            int j = i;
            while (j < segs.size() && segs.get(j).ph != null) j++;
            List<Seg> vowels = new ArrayList<>();
            for (int k = i; k < j; k++) if (segs.get(k).ph.kind == VOWEL) vowels.add(segs.get(k));
            if (!vowels.isEmpty()) {
                boolean question = vowels.get(0).question;
                int firstAcc = -1, lastAcc = -1;
                for (int k = 0; k < vowels.size(); k++) {
                    Seg v = vowels.get(k);
                    if (v.stress == 1 && !v.function) { if (firstAcc < 0) firstAcc = k; lastAcc = k; }
                }
                int startF = vowels.get(0).start, endF = vowels.get(vowels.size() - 1).start + vowels.get(vowels.size() - 1).n;
                pts.add(new float[]{startF, pitch * 1.04f});
                for (int k = 0; k < vowels.size(); k++) {
                    Seg v = vowels.get(k);
                    float pos = (v.start - startF) / (float) Math.max(1, endF - startF);
                    float base = pitch * (1.04f - DECLINE * pos);
                    float bump = (k == firstAcc) ? ACCENT_FIRST : (k == lastAcc) ? ACCENT_LAST : (v.stress == 1 && !v.function) ? 1.03f : 1f;
                    pts.add(new float[]{v.start + v.n * 0.4f, base * bump});
                }
                pts.add(new float[]{endF, question ? pitch * 1.30f : pitch * 0.84f});
            }
            i = j + 1;
        }
        if (pts.isEmpty()) { for (int f = 0; f < total; f++) F0[f] = pitch; return; }
        int pi = 0;
        float[] raw = new float[total];
        for (int f = 0; f < total; f++) {
            while (pi + 1 < pts.size() && pts.get(pi + 1)[0] <= f) pi++;
            float[] a = pts.get(pi);
            if (f <= a[0] || pi + 1 >= pts.size()) { raw[f] = a[1]; continue; }
            float[] b = pts.get(pi + 1);
            float t = (f - a[0]) / Math.max(1f, b[0] - a[0]);
            raw[f] = a[1] + (b[1] - a[1]) * t;
        }
        float[] sm = smooth(raw, 10);
        System.arraycopy(sm, 0, F0, 0, total);
    }

    /** Accents removed: "café" -> "cafe". */
    static final class Normalizer2 {
        static String fold(String s) {
            String d = java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFD);
            StringBuilder b = new StringBuilder(d.length());
            for (int i = 0; i < d.length(); i++) {
                char c = d.charAt(i);
                if (Character.getType(c) != Character.NON_SPACING_MARK) b.append(c);
            }
            return b.toString();
        }
    }

    // ---------------- Kaivra's own spelling-to-sound rules, for words not in the dictionary ----------------

    static final class Rules {
        private static boolean vowelCh(char c) { return "aeiouy".indexOf(c) >= 0; }

        static String spell(String w) {
            w = w.toLowerCase(Locale.ROOT).replaceAll("[^a-z]", "");
            if (w.isEmpty()) return "";
            List<String> ph = new ArrayList<>();
            int n = w.length();
            boolean silentE = n > 2 && w.charAt(n - 1) == 'e' && !vowelCh(w.charAt(n - 2)) && hasVowelBefore(w, n - 2);
            int i = 0;
            while (i < n) {
                String rest = w.substring(i);
                char c = w.charAt(i);
                char nx = i + 1 < n ? w.charAt(i + 1) : 0;
                if (silentE && i == n - 1) break;
                if (rest.startsWith("tion")) { add(ph, "SH AH0 N"); i += 4; continue; }
                if (rest.startsWith("sion")) { add(ph, (i > 0 && vowelCh(w.charAt(i - 1)) ? "ZH" : "SH") + " AH0 N"); i += 4; continue; }
                if (rest.startsWith("ture")) { add(ph, "CH ER0"); i += 4; continue; }
                if (rest.startsWith("eigh")) { add(ph, "EY"); i += 4; continue; }
                if (rest.startsWith("igh")) { add(ph, "AY"); i += 3; continue; }
                if (rest.startsWith("ough")) { add(ph, "AO"); i += 4; continue; }
                if (rest.startsWith("augh")) { add(ph, "AO"); i += 4; continue; }
                if (rest.startsWith("tch")) { add(ph, "CH"); i += 3; continue; }
                if (rest.startsWith("dge")) { add(ph, "JH"); i += 3; continue; }
                if (rest.startsWith("sch")) { add(ph, "S K"); i += 3; continue; }
                if (rest.startsWith("air")) { add(ph, "EH R"); i += 3; continue; }
                if (rest.startsWith("ear")) { add(ph, "IH R"); i += 3; continue; }
                if (i == 0 && rest.startsWith("kn")) { add(ph, "N"); i += 2; continue; }
                if (i == 0 && rest.startsWith("wr")) { add(ph, "R"); i += 2; continue; }
                if (rest.equals("mb")) { add(ph, "M"); i += 2; continue; }
                if (rest.startsWith("ph")) { add(ph, "F"); i += 2; continue; }
                if (rest.startsWith("sh")) { add(ph, "SH"); i += 2; continue; }
                if (rest.startsWith("ch")) { add(ph, "CH"); i += 2; continue; }
                if (rest.startsWith("th")) { add(ph, "TH"); i += 2; continue; }
                if (rest.startsWith("wh")) { add(ph, "W"); i += 2; continue; }
                if (rest.startsWith("ck")) { add(ph, "K"); i += 2; continue; }
                if (rest.startsWith("ng")) { add(ph, "NG"); i += 2; continue; }
                if (rest.startsWith("nk")) { add(ph, "NG K"); i += 2; continue; }
                if (rest.startsWith("qu")) { add(ph, "K W"); i += 2; continue; }
                if (rest.startsWith("gh")) { if (i == 0) add(ph, "G"); i += 2; continue; }
                if (rest.startsWith("ee") || rest.startsWith("ea")) { add(ph, "IY"); i += 2; continue; }
                if (rest.startsWith("oo")) { add(ph, "UW"); i += 2; continue; }
                if (rest.startsWith("ou")) { add(ph, "AW"); i += 2; continue; }
                if (rest.startsWith("ow")) { add(ph, i + 2 == n ? "OW" : "AW"); i += 2; continue; }
                if (rest.startsWith("oi") || rest.startsWith("oy")) { add(ph, "OY"); i += 2; continue; }
                if (rest.startsWith("ai") || rest.startsWith("ay")) { add(ph, "EY"); i += 2; continue; }
                if (rest.startsWith("au") || rest.startsWith("aw")) { add(ph, "AO"); i += 2; continue; }
                if (rest.startsWith("oa")) { add(ph, "OW"); i += 2; continue; }
                if (rest.startsWith("ie")) { add(ph, "IY"); i += 2; continue; }
                if (rest.startsWith("ei")) { add(ph, "EY"); i += 2; continue; }
                if (rest.startsWith("ey")) { add(ph, i + 2 == n ? "IY" : "EY"); i += 2; continue; }
                if (rest.startsWith("ue") || rest.startsWith("ew")) { add(ph, "UW"); i += 2; continue; }
                if (rest.startsWith("ar")) { add(ph, "AA R"); i += 2; continue; }
                if (rest.startsWith("or")) { add(ph, "AO R"); i += 2; continue; }
                if (rest.startsWith("er") || rest.startsWith("ir") || rest.startsWith("ur")) { add(ph, "ER"); i += 2; continue; }
                if (rest.equals("ed") && i > 1) {
                    char pc = w.charAt(i - 1);
                    add(ph, (pc == 't' || pc == 'd') ? "IH D" : "pkfsx".indexOf(pc) >= 0 || w.endsWith("ched") || w.endsWith("shed") ? "T" : "D");
                    i += 2; continue;
                }
                if (rest.equals("es") && i > 1 && "sxzh".indexOf(w.charAt(i - 1)) >= 0) { add(ph, "IH Z"); i += 2; continue; }
                if (rest.equals("s") && i > 0 && "aeioubdglmnrvwy".indexOf(w.charAt(i - 1)) >= 0) { add(ph, "Z"); i += 1; continue; }
                if (i + 1 < n && c == nx && !vowelCh(c)) { i++; continue; } // double consonant
                if (vowelCh(c) && !(c == 'y' && i == 0)) {
                    boolean magic = silentE && i == n - 3;
                    boolean open = i + 2 < n && !vowelCh(nx) && vowelCh(w.charAt(i + 2)) && i + 2 != n - 1;
                    String v;
                    switch (c) {
                        case 'a': v = magic ? "EY" : "AE"; break;
                        case 'e': v = magic ? "IY" : (i == n - 1 ? (n <= 3 ? "IY" : "") : "EH"); break;
                        case 'i': v = magic ? "AY" : "IH"; break;
                        case 'o': v = magic || (i == n - 1) ? "OW" : "AA"; break;
                        case 'u': v = magic ? "UW" : open ? "UW" : "AH"; break;
                        default: v = (i == n - 1) ? (countVowels(w) > 1 ? "IY" : "AY") : "IH"; // y
                    }
                    if (!v.isEmpty()) add(ph, v);
                    i++; continue;
                }
                switch (c) {
                    case 'c': add(ph, (nx == 'e' || nx == 'i' || nx == 'y') ? "S" : "K"); break;
                    case 'g': add(ph, (nx == 'e' || nx == 'i' || nx == 'y') && i + 1 < n ? "JH" : "G"); break;
                    case 'x': add(ph, i == 0 ? "Z" : "K S"); break;
                    case 'j': add(ph, "JH"); break;
                    case 'y': add(ph, "Y"); break;
                    case 'q': add(ph, "K"); break;
                    case 'b': add(ph, "B"); break; case 'd': add(ph, "D"); break; case 'f': add(ph, "F"); break;
                    case 'h': add(ph, "HH"); break; case 'k': add(ph, "K"); break; case 'l': add(ph, "L"); break;
                    case 'm': add(ph, "M"); break; case 'n': add(ph, "N"); break; case 'p': add(ph, "P"); break;
                    case 'r': add(ph, "R"); break; case 's': add(ph, "S"); break; case 't': add(ph, "T"); break;
                    case 'v': add(ph, "V"); break; case 'w': add(ph, "W"); break; case 'z': add(ph, "Z"); break;
                    default: break;
                }
                i++;
            }
            // stress: the first vowel, or the one before -tion/-sion
            int target = 0, count = 0;
            for (int k = 0; k < ph.size(); k++) if (PH.containsKey(ph.get(k)) && PH.get(ph.get(k)).kind == VOWEL) count++;
            int idx = 0;
            if (w.endsWith("tion") || w.endsWith("sion")) target = Math.max(0, count - 2);
            StringBuilder sb = new StringBuilder();
            for (String p : ph) {
                Ph x = PH.get(p);
                String q = p;
                if (x != null && x.kind == VOWEL && !p.equals("AX")) { q = p + (idx == target ? "1" : "0"); idx++; }
                if (sb.length() > 0) sb.append(' ');
                sb.append(q);
            }
            return sb.toString();
        }

        private static void add(List<String> ph, String s) { for (String p : s.split(" ")) ph.add(p.replaceAll("[0-9]", "")); }

        private static boolean hasVowelBefore(String w, int end) {
            for (int i = 0; i < end; i++) if (vowelCh(w.charAt(i))) return true;
            return false;
        }

        private static int countVowels(String w) {
            int c = 0;
            for (int i = 0; i < w.length(); i++) if ("aeiou".indexOf(w.charAt(i)) >= 0) c++;
            return c;
        }
    }
}
