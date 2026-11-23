package com.kaivra.app;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.List;

/**
 * Speaks every line of a text file with Kaivra's voice into WAV files (for the listening test).
 * Arguments: dictionary (or -), sentences, output folder, voice number, [settings to apply (or -)], [file to save all settings].
 */
public class VoiceTest {
    public static void main(String[] a) throws Exception {
        KaivraVoice v = new KaivraVoice();
        if (!a[0].equals("-")) try (InputStream in = new FileInputStream(a[0])) { v.loadDictionary(in); }
        v.setVoice(Integer.parseInt(a[3]));
        String pack = System.getenv("KAIVRA_UNITS"); // a recorded voice pack (.bin or .bin.gz)
        if (pack != null && !pack.isEmpty()) {
            InputStream in = new FileInputStream(pack);
            if (pack.endsWith(".gz")) in = new java.util.zip.GZIPInputStream(in, 1 << 16);
            try (InputStream s = in) { v.setUnits(new KaivraUnits(s)); }
        }
        if (a.length > 4 && !a[4].equals("-")) {
            String spec = new String(Files.readAllBytes(Paths.get(a[4])), StandardCharsets.UTF_8);
            KaivraVoice.tune(spec);
            tuneUnits(spec);
        }
        if (a.length > 5) Files.write(Paths.get(a[5]), (KaivraVoice.settings() + unitSettings()).getBytes(StandardCharsets.UTF_8));
        List<String> lines = Files.readAllLines(Paths.get(a[1]), StandardCharsets.UTF_8);
        for (int i = 0; i < lines.size(); i++) {
            short[] pcm = v.synthesize(lines.get(i));
            writeWav(new File(a[2], String.format("%02d.wav", i)), pcm);
        }
    }

    /** "units.NAME = value" lines set the recorded voice's settings (KaivraUnits static fields). */
    static void tuneUnits(String spec) {
        for (String raw : spec.split("\n")) {
            String line = raw.replaceAll("#.*", "").trim();
            if (!line.startsWith("units.") || !line.contains("=")) continue;
            String key = line.substring(6, line.indexOf('=')).trim();
            String val = line.substring(line.indexOf('=') + 1).trim().split("[\\s,]+")[0];
            try {
                java.lang.reflect.Field f = KaivraUnits.class.getDeclaredField(key);
                if (f.getType() == int.class) f.setInt(null, (int) Math.round(Double.parseDouble(val)));
                else if (f.getType() == double.class) f.setDouble(null, Double.parseDouble(val));
                else f.setFloat(null, Float.parseFloat(val));
            } catch (Exception e) {
                System.err.println("unknown setting " + key);
            }
        }
    }

    static String unitSettings() {
        StringBuilder b = new StringBuilder();
        for (java.lang.reflect.Field f : KaivraUnits.class.getDeclaredFields()) {
            int m = f.getModifiers();
            if (!java.lang.reflect.Modifier.isStatic(m) || java.lang.reflect.Modifier.isFinal(m)) continue;
            Class<?> t = f.getType();
            if (t != double.class && t != int.class && t != float.class) continue;
            try { b.append("units.").append(f.getName()).append(" = ").append(f.get(null)).append('\n'); } catch (Exception e) { /* skip */ }
        }
        return b.toString();
    }

    static void writeWav(File f, short[] pcm) throws IOException {
        try (DataOutputStream o = new DataOutputStream(new BufferedOutputStream(new FileOutputStream(f)))) {
            int n = pcm.length * 2;
            o.writeBytes("RIFF"); o.writeInt(Integer.reverseBytes(36 + n)); o.writeBytes("WAVEfmt ");
            o.writeInt(Integer.reverseBytes(16)); o.writeShort(Short.reverseBytes((short) 1)); o.writeShort(Short.reverseBytes((short) 1));
            o.writeInt(Integer.reverseBytes(16000)); o.writeInt(Integer.reverseBytes(32000)); o.writeShort(Short.reverseBytes((short) 2));
            o.writeShort(Short.reverseBytes((short) 16)); o.writeBytes("data"); o.writeInt(Integer.reverseBytes(n));
            for (short s : pcm) o.writeShort(Short.reverseBytes(s));
        }
    }
}
