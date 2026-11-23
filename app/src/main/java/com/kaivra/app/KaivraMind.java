package com.kaivra.app;

import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Kaivra's thinking brain: an open language model (Qwen3.5-2B, Apache 2.0 licence, so the owner holds full rights
 * to use, change and keep it) running on the phone through the llama.cpp engine (MIT licence) and Kaivra's own
 * bridge (kaivra_mind.cpp). Pure Java, so GitHub can test the very same code on a computer before it ships.
 *
 * How it answers: when it knows, it answers straight away. When it needs facts it is not sure of, or anything recent,
 * it searches the internet with its own web reader (KaivraWeb) and answers from what it found. When a question needs
 * careful reasoning (maths, logic, code, plans) it thinks step by step first. When asked to create something, it does.
 */
public final class KaivraMind implements AutoCloseable {

    /** Receives the spoken part of the answer as it is written, piece by piece; return false to stop early. */
    public interface Listener {
        boolean onText(String piece);
    }

    /** Called from the bridge with complete UTF-8 characters. */
    public interface ByteSink {
        boolean onBytes(byte[] bytes);
    }

    /** An answer, how it was reached ("direct", "library", "search" or "think") and what it was based on. */
    public static final class Answer {
        public final String text, how;
        public final List<KaivraWeb.Found> sources;
        Answer(String text, String how, List<KaivraWeb.Found> sources) { this.text = text; this.how = how; this.sources = sources; }
    }

    private static boolean loaded;

    static synchronized void loadLibrary() {
        if (!loaded) {
            System.loadLibrary("kaivra_mind");
            loaded = true;
        }
    }

    private static native long nativeLoad(String path, int threads, int ctx);
    private static native int nativeGenerate(long handle, byte[] prompt, int maxTokens, float temp, int topK, float topP,
                                             float presence, int seed, ByteSink sink);
    private static native boolean nativePrime(long handle, byte[] prefix);
    private static native void nativeReset(long handle);
    private static native String nativeInfo(long handle);
    private static native void nativeFree(long handle);

    static final int CONTEXT = 6144;
    static final int HISTORY_CHARS = 9000;    // about 2,500 tokens of earlier conversation at most
    static final int NOTES_CHARS = 2400;      // what the web reader may hand over
    static final int THINK_TOKENS = 512;      // longest step-by-step thinking before answering
    static final int ANSWER_TOKENS = 400;

    /** Who Kaivra is and how it decides to answer, search or think. Replies are spoken aloud. */
    static final String SYSTEM =
        "You are Kaivra (pronounced Kaai-vraa), a personal assistant who lives on this phone and works only for its owner, "
        + "who created you. You are loyal, calm, sharp and a little witty, like a trusted aide. "
        + "Your replies are spoken aloud, so answer in plain sentences without lists, markdown, symbols or emojis, "
        + "usually in one to three sentences unless the owner asks for more. Answer in the language the owner uses.\n"
        + "How to answer:\n"
        + "If you know the answer well, answer directly.\n"
        + "If you need facts you are not sure of, or anything recent or changing such as news, prices, weather, scores, "
        + "who holds a position now or dates of coming events, reply with only one line: SEARCH: and a short web search "
        + "query. You will then get notes from the internet to answer from.\n"
        + "If the question needs careful reasoning, such as maths, logic, code or a plan, reply with only the word THINK. "
        + "You will then work it out step by step.\n"
        + "If you are asked to create something, such as a story, a name, an idea or a message, create it yourself.\n"
        + "Examples: for 'what is the weather in Delhi today' reply SEARCH: Delhi weather today. For 'if a train goes "
        + "60 km an hour, how long does it take to go 150 km' reply THINK. For 'hello' answer directly.\n"
        + "When notes from your knowledge library or the internet are given, rely on them and never invent facts. "
        + "Phone actions such as calls, messages, opening apps, the torch and the volume are done by your command system "
        + "when the owner asks for them directly, for example: call Rahul, or open the camera.";

    private long handle;
    private final String info;
    private String primedFor = "";

    private KaivraMind(long handle) {
        this.handle = handle;
        this.info = nativeInfo(handle);
    }

    /** Loads a GGUF model; threads should be the number of fast cores. Returns null if it cannot be loaded. */
    public static KaivraMind open(String path, int threads, int ctx) {
        loadLibrary();
        long h = nativeLoad(path, Math.max(1, threads), ctx);
        return h == 0 ? null : new KaivraMind(h);
    }

    public String info() { return info; }

    private static String today() {
        return new SimpleDateFormat("EEEE d MMMM yyyy", Locale.ENGLISH).format(new Date());
    }

    // ---------------- the conversation in the model's chat format ----------------

    static final String START = "<|im_start|>", END = "<|im_end|>\n", REPLY = "<|im_start|>assistant\n<think>\n\n</think>\n\n";

    static String system() {
        return START + "system\n" + SYSTEM + " Today is " + today() + "." + END;
    }

    /** Earlier answers are written exactly as they were produced, so the engine can carry on without re-reading. */
    static String prompt(String question, List<String[]> history, String note) {
        List<String[]> hist = new ArrayList<>(history);
        StringBuilder b;
        while (true) {
            b = new StringBuilder(system());
            for (String[] h : hist) b.append(START).append("user\n").append(h[0]).append(END).append(REPLY).append(h[1]).append(END);
            if (b.length() <= HISTORY_CHARS || hist.isEmpty()) break;
            hist.remove(0);
        }
        String q = question.trim();
        if (note != null && !note.trim().isEmpty()) q = q + "\n\n(Note from your knowledge library: " + note.trim() + ")";
        b.append(START).append("user\n").append(q).append(END).append(REPLY);
        return b.toString();
    }

    private static final Pattern THINK_BLOCK = Pattern.compile("(?s)<think>.*?(</think>|$)");
    private static final Pattern MARKS = Pattern.compile("[*#`_]{1,3}");

    /** Removes anything the owner should not hear: thinking, markdown marks, control words, extra spaces. */
    static String clean(String s) {
        String t = THINK_BLOCK.matcher(s).replaceAll("");
        t = t.replace("<|im_end|>", "").replace("<|endoftext|>", "").replace("</think>", "");
        t = MARKS.matcher(t).replaceAll("");
        return t.replaceAll("[ \\t]+", " ").replaceAll("\\n{3,}", "\n\n").trim();
    }

    // ---------------- generating ----------------

    private int lastResult;

    private String generate(String prompt, int maxTokens, float temp, Listener listener) {
        String day = today();
        if (!day.equals(primedFor)) {   // read Kaivra's instructions once a day; every conversation starts from there
            nativePrime(handle, system().getBytes(StandardCharsets.UTF_8));
            primedFor = day;
        }
        final StringBuilder raw = new StringBuilder();
        ByteSink sink = bytes -> {
            String piece = new String(bytes, StandardCharsets.UTF_8);
            raw.append(piece);
            return listener == null || listener.onText(piece);
        };
        lastResult = nativeGenerate(handle, prompt.getBytes(StandardCharsets.UTF_8), maxTokens, temp, 20, 0.9f, 1.5f, -1, sink);
        return raw.toString();
    }

    /** Holds back the first words until it is clear whether they are an answer (passed on) or SEARCH / THINK. */
    private static final class Gate implements Listener {
        private final Listener next;
        private final StringBuilder head = new StringBuilder();
        String signal = "";   // "", "search" or "think" once decided
        boolean decided;

        Gate(Listener next) { this.next = next; }

        @Override
        public boolean onText(String piece) {
            if (decided) {
                if (signal.equals("search")) return !piece.contains("\n");  // read the query line, then stop
                return next == null || next.onText(piece);
            }
            head.append(piece);
            String h = head.toString().replaceAll("^\\s+", "");
            String up = h.toUpperCase(Locale.ROOT);
            if (up.startsWith("SEARCH")) {
                decided = true;
                signal = "search";
                return !h.contains("\n");
            }
            if (up.startsWith("THINK")) {
                decided = true;
                signal = "think";
                return false;
            }
            if (h.length() >= 7 || h.contains("\n") || (!"SEARCH".startsWith(up) && !"THINK".startsWith(up))) {
                decided = true;
                return next == null || next.onText(head.toString());
            }
            return true;
        }
    }

    /**
     * Answers one question in the ongoing conversation (history: {question, answer} pairs, oldest first). fact is a
     * note from the knowledge library, or null. The listener, if any, hears the spoken answer as it is written.
     */
    public synchronized Answer answer(String question, List<String[]> history, String fact, Listener listener) {
        List<KaivraWeb.Found> sources = new ArrayList<>();
        if (handle == 0) return new Answer("", "none", sources);
        if (fact != null && !fact.trim().isEmpty()) {
            String raw = generate(prompt(question, history, fact), ANSWER_TOKENS, 0.6f, listener);
            return new Answer(clean(raw), "library", sources);
        }

        String p1 = prompt(question, history, null);
        Gate gate = new Gate(listener);
        String raw1 = generate(p1, ANSWER_TOKENS, 0.6f, gate);

        if (gate.signal.equals("search")) {
            String line = raw1.replaceAll("^\\s+", "");
            int nl = line.indexOf('\n');
            String query = (nl >= 0 ? line.substring(0, nl) : line).replaceFirst("(?i)^SEARCH\\s*:?", "").trim();
            if (query.isEmpty()) query = question;
            String notes = KaivraWeb.notes(query, NOTES_CHARS, sources);
            if (notes.isEmpty()) notes = "Nothing could be found online just now. Answer from what you know, and say if you are not sure.";
            String p2 = p1 + raw1 + END + START + "user\n<tool_response>\n" + notes + "\n</tool_response>\n"
                + "Answer my question from these notes, briefly." + END + REPLY;
            String raw2 = generate(p2, ANSWER_TOKENS, 0.6f, listener);
            return new Answer(clean(raw2), "search", sources);
        }

        if (gate.signal.equals("think")) {
            String p2 = p1 + raw1 + END + START + "user\nWork it out step by step, then give me the answer." + END
                + START + "assistant\n<think>\n";
            String thought = generate(p2, THINK_TOKENS, 0.8f, null);
            int close = thought.indexOf("</think>");
            String spoken;
            if (close >= 0 && !clean(thought.substring(close + 8)).isEmpty()) {
                spoken = thought.substring(close + 8);
                if (listener != null) listener.onText(spoken);
            } else {
                // thought for long enough (or stopped right after thinking): now say the answer
                String p3 = p2 + thought + (close >= 0 ? "" : "\n</think>\n\n");
                spoken = generate(p3, ANSWER_TOKENS, 0.6f, listener);
            }
            return new Answer(clean(spoken), "think", sources);
        }

        return new Answer(clean(raw1), "direct", sources);
    }

    /** Forgets the conversation held in the engine's memory. */
    public synchronized void reset() {
        if (handle != 0) nativeReset(handle);
        primedFor = "";
    }

    @Override
    public synchronized void close() {
        if (handle != 0) {
            nativeFree(handle);
            handle = 0;
        }
    }
}
