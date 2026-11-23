package com.kaivra.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Kaivra's own web reader, used when its brain does not know an answer: searches the open web and Wikipedia,
 * reads the best pages and turns them into short notes for the brain. Pure Java (no libraries), so the same
 * code runs on the phone and in GitHub's tests.
 */
public final class KaivraWeb {
    static final String AGENT = "Kaivra/0.1 (personal assistant; https://github.com/roshanprajapati7311-netizen/Claude)";

    /** One thing found: where it came from and what it says. */
    public static final class Found {
        public final String title, url, text;
        Found(String title, String url, String text) { this.title = title; this.url = url; this.text = text; }
    }

    // ---------------- fetching ----------------

    static String get(String url, int maxBytes) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(10000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", AGENT);
        c.setRequestProperty("Accept-Language", "en");
        int code = c.getResponseCode();
        if (code < 200 || code > 299) throw new IOException("HTTP " + code);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0 && out.size() < maxBytes) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    static String enc(String s) {
        try { return URLEncoder.encode(s, "UTF-8"); } catch (Exception e) { return s; }
    }

    // ---------------- text from HTML ----------------

    private static final Pattern DROP = Pattern.compile("(?is)<(script|style|noscript|svg|nav|header|footer|form|aside|iframe)\\b.*?</\\1\\s*>");
    private static final Pattern BREAK = Pattern.compile("(?i)<(br|/p|/div|/li|/h[1-6]|/tr|/section|/article)\\b[^>]*>");
    private static final Pattern TAG = Pattern.compile("<[^>]+>");
    private static final Pattern ENTITY = Pattern.compile("&(#x?[0-9a-fA-F]+|[a-zA-Z]+);");

    static String unescape(String s) {
        Matcher m = ENTITY.matcher(s);
        StringBuffer b = new StringBuffer();
        while (m.find()) {
            String e = m.group(1), r;
            try {
                if (e.startsWith("#x") || e.startsWith("#X")) r = new String(Character.toChars(Integer.parseInt(e.substring(2), 16)));
                else if (e.startsWith("#")) r = new String(Character.toChars(Integer.parseInt(e.substring(1))));
                else {
                    switch (e) {
                        case "amp": r = "&"; break;
                        case "lt": r = "<"; break;
                        case "gt": r = ">"; break;
                        case "quot": r = "\""; break;
                        case "apos": r = "'"; break;
                        case "nbsp": r = " "; break;
                        case "ndash": r = "-"; break;
                        case "mdash": r = " - "; break;
                        case "hellip": r = "..."; break;
                        default: r = " ";
                    }
                }
            } catch (Exception ex) {
                r = " ";
            }
            m.appendReplacement(b, Matcher.quoteReplacement(r));
        }
        m.appendTail(b);
        return b.toString();
    }

    /** The readable text of a web page: paragraphs of real sentences, without menus and scripts. */
    static String pageText(String html, int maxChars) {
        String t = DROP.matcher(html).replaceAll(" ");
        t = BREAK.matcher(t).replaceAll("\n");
        t = unescape(TAG.matcher(t).replaceAll(" "));
        StringBuilder out = new StringBuilder();
        for (String line : t.split("\n")) {
            String p = line.replaceAll("\\s+", " ").trim();
            if (p.length() < 60 || !p.contains(" ") || p.split(" ").length < 8) continue; // menus, buttons, captions
            out.append(p).append('\n');
            if (out.length() >= maxChars) break;
        }
        return out.length() > maxChars ? out.substring(0, maxChars) : out.toString().trim();
    }

    static String plain(String htmlSnippet) {
        return unescape(TAG.matcher(htmlSnippet).replaceAll("")).replaceAll("\\s+", " ").trim();
    }

    // ---------------- searching ----------------

    private static final Pattern DDG_RESULT = Pattern.compile(
        "(?s)class=\"result__a\"[^>]*href=\"([^\"]+)\"[^>]*>(.*?)</a>.*?class=\"result__snippet\"[^>]*>(.*?)</a>");

    /** The open web (DuckDuckGo's plain HTML page): title, address and the snippet of each result. */
    public static List<Found> searchWeb(String query, int max) {
        List<Found> out = new ArrayList<>();
        try {
            String html = get("https://html.duckduckgo.com/html/?q=" + enc(query), 600_000);
            Matcher m = DDG_RESULT.matcher(html);
            while (m.find() && out.size() < max) {
                String href = unescape(m.group(1));
                int u = href.indexOf("uddg=");
                if (u >= 0) {
                    String target = href.substring(u + 5);
                    int amp = target.indexOf('&');
                    if (amp >= 0) target = target.substring(0, amp);
                    href = URLDecoder.decode(target, "UTF-8");
                }
                if (href.startsWith("//")) href = "https:" + href;
                if (href.contains("duckduckgo.com/y.js")) continue; // adverts
                out.add(new Found(plain(m.group(2)), href, plain(m.group(3))));
            }
        } catch (Exception e) {
            // no web results: Wikipedia may still answer
        }
        return out;
    }

    /** Wikipedia: the opening of the best-matching article(s). */
    public static List<Found> searchWikipedia(String query, int max) {
        List<Found> out = new ArrayList<>();
        try {
            Object s = MiniJson.parse(get("https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit="
                + max + "&srprop=&srsearch=" + enc(query), 200_000));
            List<String> titles = new ArrayList<>();
            for (Object r : MiniJson.list(MiniJson.at(s, "query", "search"))) {
                Object t = MiniJson.at(r, "title");
                if (t instanceof String) titles.add((String) t);
            }
            for (String title : titles) {
                Object e = MiniJson.parse(get("https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1"
                    + "&redirects=1&format=json&titles=" + enc(title), 300_000));
                Object pages = MiniJson.at(e, "query", "pages");
                if (pages instanceof Map) {
                    for (Object p : ((Map<?, ?>) pages).values()) {
                        Object text = MiniJson.at(p, "extract");
                        if (text instanceof String && ((String) text).length() > 40) {
                            String x = ((String) text).trim();
                            out.add(new Found(title, "https://en.wikipedia.org/wiki/" + title.replace(' ', '_'),
                                x.length() > 1200 ? x.substring(0, 1200) : x));
                        }
                    }
                }
            }
        } catch (Exception e) {
            // offline or nothing found
        }
        return out;
    }

    /** Reads one page and returns its main text (up to maxChars), or "" if it cannot be read. */
    public static String read(String url, int maxChars) {
        try {
            return pageText(get(url, 1_500_000), maxChars);
        } catch (Exception e) {
            return "";
        }
    }

    /**
     * Everything Kaivra needs to answer a question it could not answer alone: web snippets, the best page's text and
     * Wikipedia's article, as short notes (about maxChars long). The list collects the sources used.
     */
    public static String notes(String query, int maxChars, List<Found> sources) {
        StringBuilder b = new StringBuilder();
        List<Found> web = searchWeb(query, 5);
        for (Found f : web) {
            if (f.text.isEmpty()) continue;
            b.append("- ").append(f.title).append(": ").append(f.text).append('\n');
            sources.add(f);
        }
        // the first page that reads well, for details the snippets leave out
        for (Found f : web) {
            if (b.length() > maxChars * 2 / 3) break;
            if (f.url.contains("youtube.com") || f.url.endsWith(".pdf")) continue;
            String page = read(f.url, Math.min(1800, maxChars - b.length()));
            if (page.length() > 200) {
                b.append("From ").append(f.title).append(": ").append(page.replace('\n', ' ')).append('\n');
                break;
            }
        }
        if (b.length() < maxChars * 3 / 4) {
            for (Found w : searchWikipedia(query, 1)) {
                b.append("Wikipedia, ").append(w.title).append(": ").append(w.text.replace('\n', ' ')).append('\n');
                sources.add(w);
            }
        }
        String s = b.toString().trim();
        return s.length() > maxChars ? s.substring(0, maxChars) : s;
    }

    // ---------------- a small JSON reader (enough for Wikipedia's answers) ----------------

    static final class MiniJson {
        private final String s;
        private int i;

        private MiniJson(String s) { this.s = s; }

        static Object parse(String text) {
            MiniJson p = new MiniJson(text);
            p.ws();
            return p.value();
        }

        static Object at(Object o, String... keys) {
            for (String k : keys) {
                if (!(o instanceof Map)) return null;
                o = ((Map<?, ?>) o).get(k);
            }
            return o;
        }

        static List<?> list(Object o) { return o instanceof List ? (List<?>) o : new ArrayList<>(); }

        private void ws() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }

        private Object value() {
            if (i >= s.length()) throw new IllegalArgumentException("end");
            char c = s.charAt(i);
            if (c == '{') {
                Map<String, Object> m = new LinkedHashMap<>();
                i++; ws();
                if (s.charAt(i) == '}') { i++; return m; }
                while (true) {
                    ws();
                    String k = string();
                    ws(); i++; ws(); // ':'
                    m.put(k, value());
                    ws();
                    char d = s.charAt(i++);
                    if (d == '}') return m;
                }
            }
            if (c == '[') {
                List<Object> l = new ArrayList<>();
                i++; ws();
                if (s.charAt(i) == ']') { i++; return l; }
                while (true) {
                    ws();
                    l.add(value());
                    ws();
                    char d = s.charAt(i++);
                    if (d == ']') return l;
                }
            }
            if (c == '"') return string();
            if (s.startsWith("true", i)) { i += 4; return Boolean.TRUE; }
            if (s.startsWith("false", i)) { i += 5; return Boolean.FALSE; }
            if (s.startsWith("null", i)) { i += 4; return null; }
            int st = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
            return Double.parseDouble(s.substring(st, i));
        }

        private String string() {
            StringBuilder b = new StringBuilder();
            i++; // opening quote
            while (true) {
                char c = s.charAt(i++);
                if (c == '"') return b.toString();
                if (c != '\\') { b.append(c); continue; }
                char e = s.charAt(i++);
                switch (e) {
                    case 'n': b.append('\n'); break;
                    case 't': b.append('\t'); break;
                    case 'r': b.append('\r'); break;
                    case 'b': b.append('\b'); break;
                    case 'f': b.append('\f'); break;
                    case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                    default: b.append(e);
                }
            }
        }
    }
}
