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
    static final int NOTES_CHARS = 3000;      // what the web reader may hand over
    static final int THINK_TOKENS = 512;      // longest step-by-step thinking before answering
    static final int ANSWER_TOKENS = 400;

    /** Who Kaivra is and how it decides to answer, search or think. Replies are spoken aloud. */
    static final String SYSTEM =
        "You are Kaivra (pronounced Kaai-vraa), a personal assistant who lives on this phone and works only for its owner, "
        + "who created you. You are loyal, calm, sharp and a little witty, like a trusted aide. "
        + "Your replies are spoken aloud, so answer in plain sentences without lists, markdown, symbols or emojis, "
        + "usually in one to three sentences unless the owner asks for more. Answer in the language of the owner's latest "
        + "message.\n"
        + "How to answer:\n"
        + "If you know the answer well, answer directly.\n"
        + "If you need facts you are not sure of, or anything recent or changing such as news, prices, weather, scores, "
        + "who holds a position now or dates of coming events, reply with only one line: SEARCH: and a short web search "
        + "query. You will then get notes from the internet to answer from.\n"
        + "If the question needs careful reasoning, such as maths, logic, code or a plan, reply with only the word THINK. "
        + "You will then work it out step by step.\n"
        + "If you are asked to create something, such as a story, a name, an idea or a message, create it yourself.\n"
        + "Examples: for 'what is the weather in Delhi today' reply SEARCH: Delhi weather today. For 'if a train goes "
        + "60 km an hour, how long does it take to go 150 km' reply THINK. For 'hello' or 'explain how rain forms' answer "
        + "directly.\n"
        + "When notes from your knowledge library or the internet are given, rely on them and never invent facts. "
        + "What you can do: answer questions, look things up on the internet, work through maths, code and plans, write and "
        + "create, and through your command system call and text contacts, open apps, turn the torch on and off, change "
        + "the volume, take screenshots and lock the phone. Do not claim any other abilities. Phone actions are done by your "
        + "command system when the owner asks for them directly, for example: call Rahul, or open the camera.";

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

    static String prompt(String question, List<String[]> history, String note) { return prompt(question, history, note, null); }

    /**
     * Earlier answers are written exactly as they were produced, so the engine can carry on without re-reading. hint is
     * a short instruction added after the question (or null).
     */
    static String prompt(String question, List<String[]> history, String note, String hint) {
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
        if (hint != null) q = q + "\n\n(" + hint + ")";
        b.append(START).append("user\n").append(q).append(END).append(REPLY);
        return b.toString();
    }

    private static final Pattern THINK_BLOCK = Pattern.compile("(?s)<think>.*?(</think>|$)");

    /** Removes what is not part of the answer: thinking, control words, bold marks, extra blank lines. Code stays as written. */
    static String clean(String s) {
        String t = THINK_BLOCK.matcher(s).replaceAll("");
        t = t.replace("<|im_end|>", "").replace("<|endoftext|>", "").replace("</think>", "").replace("**", "");
        return t.replaceAll("[ \\t]+\n", "\n").replaceAll("\\n{3,}", "\n\n").trim();
    }

    // ---------------- choosing how to answer ----------------

    private static final Pattern CREATE = Pattern.compile(
        "(?i)^\\s*(please\\s+)?(write|create|compose|make up|make me|draft|invent|imagine|tell me a (story|joke|poem)|"
        + "give me (an? )?(idea|name|story|poem|joke|line|quote)s?)\\b|\\b(sunao|likho|shayari|kavita)\\b");
    private static final Pattern RECENT = Pattern.compile(
        "(?i)\\b(today|tonight|tomorrow|yesterday|right now|currently|current|latest|recent|recently|newest|upcoming|"
        + "this (week|month|year|season)|last (week|month|year|night|match|season)|news|headlines?|weather|temperature|"
        + "forecast|price|prices|cost of|exchange rate|stock|share price|scores?|won|winners?|wins|results?|election|elected|"
        + "who is the (ceo|president|prime minister|chief minister|captain|owner|head|chairman)|release date|released|"
        + "launched|trending|live|aaj|abhi|khabar|mausam|taza)\\b|\\b20(2[5-9]|[3-9][0-9])\\b");
    private static final Pattern WORK_OUT = Pattern.compile(
        "(?i)^\\s*(please\\s+)?(solve|calculate|compute|prove|work out|figure out|plan|find the)\\b|"
        + "\\b(step by step|think it through|puzzle|riddle|logic)\\b");
    private static final Pattern NUMBER_PROBLEM = Pattern.compile(
        "(?i)(?=.*[0-9])(?=.*\\b(how (much|many|long|far|old)|total|altogether|per|each|every|average|percent|interest|"
        + "profit|loss|speed|distance|times|divided|multiply|sum|difference|remaining|left over)\\b|.*%)");
    private static final Pattern SELF = Pattern.compile(
        "(?i)\\b(who|what) are you\\b|\\bwhat (all )?can you do\\b|\\bwhat do you do\\b|\\bhow can you help\\b|"
        + "\\byour (name|abilities|skills|powers|features|purpose|creator|owner)\\b|\\bwho (made|created|built|owns) you\\b|"
        + "\\bhow are you\\b|\\babout (yourself|you)\\b|\\b(tum|aap) kaun ho\\b|\\bkya kar sakti\\b");
    private static final Pattern WEATHER = Pattern.compile("(?i)\\b(weather|temperature|forecast|rain|mausam)\\b");
    private static final Pattern GAVE_UP = Pattern.compile(
        "(?i)real[- ]time|my knowledge|knowledge cut|as of my|(don't|do not|cannot|can't) (have access|browse|access the internet|"
        + "check)|(recommend|suggest) (you )?(search|check)|latest information|up-to-date information|not able to provide (current|live)");

    /** "search", "think", "self" (about Kaivra itself) or "" (let the brain decide), from the words of the question. */
    static String route(String question) {
        String q = question.trim();
        if (CREATE.matcher(q).find()) return "";
        if (SELF.matcher(q).find() && !WORK_OUT.matcher(q).find() && !NUMBER_PROBLEM.matcher(q).find()) return "self";
        if (RECENT.matcher(q).find()) return "search";
        if (WORK_OUT.matcher(q).find() || NUMBER_PROBLEM.matcher(q).find()) return "think";
        return "";
    }

    private static boolean isSignal(String text) {
        // as the model writes them: THINK alone on its line, or SEARCH: and a query (not "Search engines are ...")
        return text.trim().matches("(?s)^(THINK[.!]?[ \\t]*(\\n.*)?|SEARCH[ \\t]*:.*)");
    }

    /** An answer that starts with a leftover THINK or SEARCH line loses that line. */
    static String dropSignal(String text) {
        String t = text.trim();
        if (!isSignal(t)) return t;
        int nl = t.indexOf('\n');
        return nl < 0 ? "" : t.substring(nl + 1).trim();
    }

    /** The last statement of the thinking (its conclusion), for when the model will not say the answer itself. */
    static String conclusion(String thinking) {
        String t = thinking.replace("<think>", "").replace("</think>", "").trim();
        String[] parts = t.split("(?<=[.!])\\s+");
        for (int i = parts.length - 1; i >= 0; i--) {
            String p = parts[i].trim();
            if (p.length() > 8 && !p.endsWith("?") && !p.matches("(?i)^(wait|hmm|let me|okay|ok|so let's).*")) return p;
        }
        return "";
    }

    static final String SELF_HINT = "This is about you, Kaivra. Answer it yourself from what you know about yourself.";
    static final String THINK_HINT = "Work this out step by step in your thinking, then tell me the answer in one or two "
        + "sentences. Do not reply THINK or SEARCH.";

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
        String way = route(question);
        if (way.equals("search")) return searched(question, question, history, listener, sources);
        if (way.equals("think")) return thought(question, history, listener);
        if (way.equals("self")) {
            String raw = generate(prompt(question, history, fact, SELF_HINT), ANSWER_TOKENS, 0.6f, listener);
            return new Answer(dropSignal(clean(raw)), "direct", sources);
        }
        if (fact != null && !fact.trim().isEmpty()) {
            String raw = generate(prompt(question, history, fact), ANSWER_TOKENS, 0.6f, listener);
            return new Answer(clean(raw), "library", sources);
        }

        // let the brain decide: answer, SEARCH: query, or THINK
        String p1 = prompt(question, history, null);
        Gate gate = new Gate(listener);
        String raw1 = generate(p1, ANSWER_TOKENS, 0.6f, gate);
        if (gate.signal.equals("search")) {
            String line = raw1.replaceAll("^\\s+", "");
            int nl = line.indexOf('\n');
            String query = (nl >= 0 ? line.substring(0, nl) : line).replaceFirst("(?i)^SEARCH\\s*:?", "").trim();
            return searched(question, query.isEmpty() ? question : query, history, listener, sources);
        }
        if (gate.signal.equals("think")) return thought(question, history, listener);
        String text = clean(raw1);
        if (GAVE_UP.matcher(text).find() || text.isEmpty() || isSignal(text)) {
            // it did not know after all: look it up
            return searched(question, question, history, listener, sources);
        }
        return new Answer(text, "direct", sources);
    }

    /** Searches the web for query, then answers the question from what was found. */
    private Answer searched(String question, String query, List<String[]> history, Listener listener, List<KaivraWeb.Found> sources) {
        String q = query.replaceAll("(?i)\\b(kaivra|please|can you|could you|tell me|do you know)\\b", " ").replaceAll("\\s+", " ").trim();
        // anything recent (except the weather) also gets the newest news on it, with dates
        boolean recent = (RECENT.matcher(question).find() || RECENT.matcher(query).find()) && !WEATHER.matcher(question).find();
        // the weather comes straight from a weather service; everything else from news, the web and Wikipedia
        String notes = WEATHER.matcher(question).find() ? KaivraWeb.weather(question, sources) : "";
        if (notes.isEmpty()) notes = KaivraWeb.notes(q.isEmpty() ? question : q, NOTES_CHARS, sources, recent);
        if (notes.isEmpty()) {
            notes = "Nothing could be found online just now (the phone may be offline). Answer from what you know, and say "
                + "clearly that you could not check it online.";
        }
        String p = prompt(question, history, null);
        p = p.substring(0, p.length() - REPLY.length())   // the question, then the notes as Kaivra's own lookup
            + REPLY + "SEARCH: " + q + END + START + "user\n<tool_response>\n" + notes + "\n</tool_response>\n"
            + "Using these notes, answer exactly what I asked in one to three sentences, in the language of my question, as "
            + "if you looked it up yourself. Do not mention the notes, add unrelated news, or add warnings. Prefer the "
            + "newest dated facts. Never guess names, dates or numbers that the notes do not state. Only if the notes do not "
            + "contain the answer, say you could not find it."
            + END + REPLY;
        String raw = generate(p, ANSWER_TOKENS, 0.5f, listener);
        return new Answer(dropSignal(clean(raw)), "search", sources);
    }

    /** Thinks step by step (not spoken), then says the answer. */
    private Answer thought(String question, List<String[]> history, Listener listener) {
        String p = prompt(question, history, null, THINK_HINT);
        p = p.substring(0, p.length() - REPLY.length()) + START + "assistant\n<think>\n";
        String thinking = generate(p, THINK_TOKENS, 0.7f, null);
        int close = thinking.indexOf("</think>");
        String spoken = close >= 0 ? dropSignal(clean(thinking.substring(close + 8))) : "";
        if (spoken.isEmpty()) {
            // thought for long enough (or stopped right after thinking): now say the answer
            String done = close >= 0 ? thinking.substring(0, close + 8) + "\n\n" : thinking + "\n</think>\n\n";
            spoken = dropSignal(clean(generate(p + done, ANSWER_TOKENS, 0.5f, listener)));
            if (spoken.isEmpty()) {
                // it still would not say it: its own conclusion is the answer
                spoken = conclusion(close >= 0 ? thinking.substring(0, close) : thinking);
                if (listener != null && !spoken.isEmpty()) listener.onText(spoken);
            }
        } else if (listener != null) {
            listener.onText(spoken);
        }
        return new Answer(spoken, "think", new ArrayList<>());
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
