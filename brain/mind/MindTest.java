package com.kaivra.app;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

/**
 * GitHub's test of Kaivra's thinking brain: the same Java code and bridge the phone runs, on a computer.
 * Arguments: model.gguf questions.txt [threads]. In questions.txt: one question per line, "---" starts a new
 * conversation, and "question || note" gives a note from the knowledge library. Prints a report in Markdown.
 */
public class MindTest {
    public static void main(String[] a) throws Exception {
        long t0 = System.nanoTime();
        int threads = a.length > 2 ? Integer.parseInt(a[2]) : 4;
        KaivraMind m = KaivraMind.open(a[0], threads, KaivraMind.CONTEXT);
        if (m == null) {
            System.out.println("Could not load " + a[0]);
            System.exit(1);
        }
        System.out.printf("# Kaivra's thinking brain%n%nModel: %s, loaded in %.1f s, %d threads%n%n", m.info(), secs(t0), threads);
        List<String[]> hist = new ArrayList<>();
        int asked = 0;
        double total = 0;
        for (String line : Files.readAllLines(Paths.get(a[1]), StandardCharsets.UTF_8)) {
            line = line.trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            if (line.equals("---")) { hist.clear(); System.out.println("---\n"); continue; }
            String q = line, fact = null;
            int bar = line.indexOf(" || ");
            if (bar >= 0) { q = line.substring(0, bar); fact = line.substring(bar + 4); }
            long t = System.nanoTime();
            final double[] first = {-1};
            KaivraMind.Answer ans = m.answer(q, hist, fact, piece -> {
                if (first[0] < 0) first[0] = secs(t);
                return true;
            });
            double s = secs(t);
            total += s;
            asked++;
            System.out.printf("**Q:** %s%n%n**A** (%s, %.1f s, first words after %.1f s): %s%n%n", q, ans.how, s, first[0], ans.text);
            for (KaivraWeb.Found f : ans.sources) System.out.printf("- source: %s, %s%n", f.title, f.url);
            if (!ans.sources.isEmpty()) System.out.println();
            hist.add(new String[]{q, ans.text});
            if (hist.size() > 4) hist.remove(0);
        }
        System.out.printf("%d questions, %.1f s on average%n", asked, asked == 0 ? 0 : total / asked);
        m.close();
    }

    static double secs(long t0) { return (System.nanoTime() - t0) / 1e9; }
}
