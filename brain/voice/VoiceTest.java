package com.kaivra.app;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.List;

/** Speaks every line of a text file with Kaivra's voice into WAV files (for the listening test). */
public class VoiceTest {
    public static void main(String[] a) throws Exception {
        KaivraVoice v = new KaivraVoice();
        if (!a[0].equals("-")) try (InputStream in = new FileInputStream(a[0])) { v.loadDictionary(in); }
        v.setVoice(Integer.parseInt(a[3]));
        if (a.length > 4) KaivraVoice.tune(new String(Files.readAllBytes(Paths.get(a[4])), StandardCharsets.UTF_8));
        List<String> lines = Files.readAllLines(Paths.get(a[1]), StandardCharsets.UTF_8);
        for (int i = 0; i < lines.size(); i++) {
            short[] pcm = v.synthesize(lines.get(i));
            writeWav(new File(a[2], String.format("%02d.wav", i)), pcm);
        }
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
