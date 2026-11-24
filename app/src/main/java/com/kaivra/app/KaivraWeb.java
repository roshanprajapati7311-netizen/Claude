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
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;
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
        final long when;   // when it was published (news), 0 if unknown
        Found(String title, String url, String text) { this(title, url, text, 0); }
        Found(String title, String url, String text, long when) { this.title = title; this.url = url; this.text = text; this.when = when; }
    }

    // ---------------- fetching ----------------

    static String get(String url, int maxBytes) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(6000);
        c.setReadTimeout(8000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", AGENT);
        c.setRequestProperty("Accept-Language", "en");
        int code = c.getResponseCode();
        if (code < 200 || code > 299 || code == 202) throw new IOException("HTTP " + code);   // 202: a service turning robots away
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
    private static final Pattern LITE_RESULT = Pattern.compile(
        "(?s)<a\\b([^>]*class=['\"]result-link['\"][^>]*)>(.*?)</a>.*?class=['\"]result-snippet['\"][^>]*>(.*?)</td>");
    private static final Pattern HREF = Pattern.compile("href=['\"]([^'\"]+)['\"]");
    private static final Pattern ITEM = Pattern.compile("(?s)<item\\b[^>]*>(.*?)</item>");
    private static final Pattern DAY = Pattern.compile("\\b(\\d{1,2} [A-Z][a-z]{2} \\d{4})\\b");

    /** Which search services answered the last notes() call (for GitHub's tests). */
    public static volatile String lastVia = "";

    /** What went wrong in recent searches ("service: reason"), for GitHub's tests; whoever reads it clears it. */
    public static final List<String> trouble = Collections.synchronizedList(new ArrayList<>());

    static void trouble(String name, Exception e) {
        trouble.add(name + ": " + e.getClass().getSimpleName() + (e.getMessage() == null ? "" : " " + e.getMessage()));
    }

    /** The real address behind a search service's redirect link. */
    static String target(String href, String param) {
        href = unescape(href);
        int u = href.indexOf(param + "=");
        if (u >= 0) {
            String t = href.substring(u + param.length() + 1);
            int amp = t.indexOf('&');
            if (amp >= 0) t = t.substring(0, amp);
            try { href = URLDecoder.decode(t, "UTF-8"); } catch (Exception e) { /* keep it as it is */ }
        }
        if (href.startsWith("//")) href = "https:" + href;
        return href;
    }

    /** Services that just failed rest for ten minutes, so Kaivra does not wait for them on every question. */
    private static final Map<String, Long> RESTING = new ConcurrentHashMap<>();

    private static boolean resting(String name) {
        Long until = RESTING.get(name);
        return until != null && System.currentTimeMillis() < until;
    }

    private static void rest(String name) { RESTING.put(name, System.currentTimeMillis() + 10 * 60_000L); }

    private static final Set<String> STOP = new HashSet<>(Arrays.asList(("what whats who whom whose which when where why how "
        + "the and for are was were is isn this that these those with from about into most more recent latest newest today "
        + "tonight tomorrow current currently now tell give show please kaivra news week month year does did can could would "
        + "you your have has had will any some all there their its it's i'm me my our who's what's ki ka ke hai aaj "
        + "stories story headlines headline").split(" ")));

    /** The words of a query that matter (not question words and fillers). */
    static List<String> keywords(String query) {
        List<String> k = new ArrayList<>();
        for (String w : query.toLowerCase().split("[^\\p{L}\\p{N}']+")) {
            if (w.length() >= 3 && !STOP.contains(w) && !k.contains(w)) k.add(w);
        }
        return k;
    }

    /** Keeps the results that are about the query: enough of its words appear in the title or the text. */
    static List<Found> relevant(List<Found> found, String query) {
        List<String> k = keywords(query);
        if (k.isEmpty()) return found;
        int need = Math.max(1, (k.size() + 2) / 3);
        List<Found> out = new ArrayList<>();
        for (Found f : found) {
            String t = (f.title + " " + f.text).toLowerCase();
            int hits = 0;
            for (String w : k) if (t.contains(w)) hits++;
            if (hits >= need) out.add(f);
        }
        return out;
    }

    private static List<Found> duckDuckGo(String query, int max) throws IOException {
        List<Found> out = new ArrayList<>();
        Matcher m = DDG_RESULT.matcher(get("https://html.duckduckgo.com/html/?q=" + enc(query), 600_000));
        while (m.find() && out.size() < max) {
            String href = target(m.group(1), "uddg");
            if (href.contains("duckduckgo.com/y.js")) continue; // adverts
            out.add(new Found(plain(m.group(2)), href, plain(m.group(3))));
        }
        return out;
    }

    private static List<Found> duckDuckGoLite(String query, int max) throws IOException {
        List<Found> out = new ArrayList<>();
        Matcher m = LITE_RESULT.matcher(get("https://lite.duckduckgo.com/lite/?q=" + enc(query), 600_000));
        while (m.find() && out.size() < max) {
            Matcher h = HREF.matcher(m.group(1));
            if (!h.find()) continue;
            String href = target(h.group(1), "uddg");
            if (href.contains("duckduckgo.com/y.js")) continue;
            out.add(new Found(plain(m.group(2)), href, plain(m.group(3))));
        }
        return out;
    }

    /** One field of an RSS item, as plain text. */
    static String rss(String item, String tag) {
        Matcher m = Pattern.compile("(?s)<" + tag + "\\b[^>]*>(.*?)</" + tag + ">").matcher(item);
        if (!m.find()) return "";
        String v = m.group(1).trim();
        if (v.startsWith("<![CDATA[")) v = v.substring(9, v.endsWith("]]>") ? v.length() - 3 : v.length());
        // the text may be HTML written inside the XML, sometimes escaped twice
        return TAG.matcher(plain(unescape(v))).replaceAll(" ").replaceAll("\\s+", " ").trim();
    }

    /** Results from an RSS feed (Bing's web and news searches, Google News): title, address, date and text. */
    private static List<Found> feed(String url, int max, boolean dated) throws IOException {
        List<Found> out = new ArrayList<>();
        Matcher m = ITEM.matcher(get(url, 600_000));
        while (m.find() && out.size() < max) {
            String it = m.group(1);
            String title = rss(it, "title");
            if (title.isEmpty()) continue;
            String text = rss(it, "description");
            String head = title.length() > 20 ? title.substring(0, 20) : title;
            if (text.startsWith(head)) text = "";   // Google News only repeats the headline and the paper's name
            long when = 0;
            if (dated) {
                String pub = rss(it, "pubDate");
                Matcher d = DAY.matcher(pub);
                if (d.find()) text = d.group(1) + (text.isEmpty() ? "" : ". " + text);
                try {
                    when = new java.text.SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", java.util.Locale.ENGLISH).parse(pub).getTime();
                } catch (Exception e) { /* no date */ }
            }
            out.add(new Found(title, target(rss(it, "link"), "url"), text.length() > 300 ? text.substring(0, 300) : text, when));
        }
        return out;
    }

    /**
     * The open web: title, address and snippet of each result. Tries DuckDuckGo, its light page, then Bing, because a
     * search service sometimes stops answering for a while. via collects the name of the one that answered.
     */
    public static List<Found> searchWeb(String query, int max, List<String> via) {
        String[] names = {"DuckDuckGo", "DuckDuckGo Lite", "Bing"};
        for (int i = 0; i < names.length; i++) {
            if (resting(names[i])) continue;
            try {
                List<Found> r = i == 0 ? duckDuckGo(query, max + 3) : i == 1 ? duckDuckGoLite(query, max + 3)
                    : feed("https://www.bing.com/search?format=rss&mkt=en-IN&q=" + enc(query), max + 5, false);
                r = relevant(r, query);   // Bing's feed sometimes answers with pages about something else entirely
                if (!r.isEmpty()) { via.add(names[i]); return r.size() > max ? r.subList(0, max) : r; }
            } catch (Exception e) {
                trouble(names[i], e);
                rest(names[i]);   // this one did not answer: try the next, and leave it alone for a while
            }
        }
        return new ArrayList<>();
    }

    public static List<Found> searchWeb(String query, int max) { return searchWeb(query, max, new ArrayList<>()); }

    private static final Pattern NEWS_FILLER = Pattern.compile(
        "(?i)\\b(what|what's|whats|is|are|was|were|the|a|an|any|latest|newest|recent|news|headlines?|updates?|about|on|"
        + "regarding|this|week|today|today's|tonight|right|now|tell|me|give|show|please|kaivra|happening|happened|going|"
        + "there|in the world|in|of|for|to|and|from|at|by|top|big|biggest|important|major|main|stories|story|all|"
        + "aaj|ki|ka|ke|khabar|taza)\\b|[?!.,]");

    /** Recent news with dates (Bing News, then Google News); with no topic, today's top stories (Google News first). */
    public static List<Found> searchNews(String query, int max, List<String> via) {
        String topic = NEWS_FILLER.matcher(query).replaceAll(" ").replaceAll("\\s+", " ").trim();
        if (keywords(topic).isEmpty()) topic = "";   // nothing but small words left: today's top stories
        String[] names = topic.isEmpty() ? new String[]{"Google News", "Bing News"} : new String[]{"Bing News", "Google News"};
        for (String name : names) {
            if (resting(name)) continue;
            try {
                String url = name.equals("Bing News")
                    ? "https://www.bing.com/news/search?format=rss&mkt=en-IN&qft=sortbydate%3d%221%22&q="
                        + enc(topic.isEmpty() ? "India top news" : topic)
                    : topic.isEmpty() ? "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en"
                    : "https://news.google.com/rss/search?hl=en-IN&gl=IN&ceid=IN:en&q=" + enc(topic);
                List<Found> r = feed(url, max + 6, true);
                if (!topic.isEmpty()) r = relevant(r, topic);
                r = new ArrayList<>(r);
                r.sort((x, y) -> Long.compare(y.when, x.when));   // newest first: old reports must not win over new ones
                if (!r.isEmpty()) { via.add(name); return r.size() > max ? r.subList(0, max) : r; }
            } catch (Exception e) {
                trouble(name, e);
                rest(name);
            }
        }
        return new ArrayList<>();
    }

    // ---------------- weather (Open-Meteo: free, no key; data CC BY 4.0) ----------------

    private static final Pattern WHEN_WORDS = Pattern.compile(
        "(?i)\\b(right now|today|tomorrow|tonight|now|currently|this week(end)?|abhi|aaj|kal|like|kaisa hai|kaisa|kaise|hai|"
        + "going to be|be)\\b");
    private static final Pattern PLACE_AFTER = Pattern.compile("(?i)\\b(?:in|at|for|of|near)\\s+([\\p{L}][\\p{L} .'-]{1,40})$");
    private static final Pattern PLACE_BEFORE = Pattern.compile(
        "(?i)([\\p{L}][\\p{L}.'-]*(?:\\s+[\\p{L}][\\p{L}.'-]*)?)\\s+(?:(?:ka|ki|ke)\\s+)?(?:weather|temperature|forecast|mausam)\\b");
    private static final Set<String> NOT_PLACE = new HashSet<>(Arrays.asList(("what whats what's is the how how's hows tell me "
        + "kaivra current today's s will it rain weather temperature forecast mausam ka ki ke my our here there outside").split(" ")));

    /** The place a weather question is about ("" if it names none). */
    static String weatherPlace(String question) {
        String s = WHEN_WORDS.matcher(question.replaceAll("[?!.,]", " ")).replaceAll(" ").replaceAll("\\s+", " ").trim();
        Matcher m = PLACE_AFTER.matcher(s);
        String raw = m.find() ? m.group(1) : "";
        if (raw.isEmpty()) {
            m = PLACE_BEFORE.matcher(s);
            if (m.find()) raw = m.group(1);
        }
        StringBuilder b = new StringBuilder();
        for (String w : raw.trim().split("\\s+")) {
            if (!w.isEmpty() && !NOT_PLACE.contains(w.toLowerCase())) b.append(b.length() > 0 ? " " : "").append(w);
        }
        return b.toString();
    }

    private static final String[][] SKY = {
        {"0", "clear sky"}, {"1", "mainly clear"}, {"2", "partly cloudy"}, {"3", "overcast"}, {"45", "fog"}, {"48", "fog"},
        {"51", "light drizzle"}, {"53", "drizzle"}, {"55", "heavy drizzle"}, {"56", "freezing drizzle"}, {"57", "freezing drizzle"},
        {"61", "light rain"}, {"63", "rain"}, {"65", "heavy rain"}, {"66", "freezing rain"}, {"67", "freezing rain"},
        {"71", "light snow"}, {"73", "snow"}, {"75", "heavy snow"}, {"77", "snow grains"}, {"80", "light showers"},
        {"81", "showers"}, {"82", "heavy showers"}, {"85", "snow showers"}, {"86", "heavy snow showers"},
        {"95", "thunderstorms"}, {"96", "thunderstorms with hail"}, {"99", "thunderstorms with hail"}};

    static String sky(Object code) {
        String c = code instanceof Double ? String.valueOf(((Double) code).intValue()) : String.valueOf(code);
        for (String[] k : SKY) if (k[0].equals(c)) return k[1];
        return "mixed weather";
    }

    private static String deg(Object v) {
        return v instanceof Double ? Math.round((Double) v) + " degrees Celsius" : "unknown";
    }

    private static Object day(Object daily, String key, int i) {
        List<?> l = MiniJson.list(MiniJson.at(daily, key));
        return i < l.size() ? l.get(i) : null;
    }

    /**
     * Current weather and the next days' forecast for the place the question names, or "" (no place, or offline):
     * Open-Meteo first, then wttr.in if Open-Meteo does not answer.
     */
    public static String weather(String question, List<Found> sources) {
        String place = weatherPlace(question);
        if (place.isEmpty()) return "";
        if (!resting("Open-Meteo")) {
            try {
                String w = openMeteo(place, sources);
                if (!w.isEmpty()) { lastVia = "Open-Meteo"; return w; }
            } catch (Exception e) {
                trouble("Open-Meteo", e);
                rest("Open-Meteo");
            }
        }
        if (!resting("wttr.in")) {
            try {
                String w = wttr(place, sources);
                if (!w.isEmpty()) { lastVia = "wttr.in"; return w; }
            } catch (Exception e) {
                trouble("wttr.in", e);
                rest("wttr.in");
            }
        }
        return "";
    }

    private static String openMeteo(String place, List<Found> sources) throws IOException {
        List<?> hits = MiniJson.list(MiniJson.at(MiniJson.parse(get("https://geocoding-api.open-meteo.com/v1/search?count=1"
            + "&language=en&format=json&name=" + enc(place), 100_000)), "results"));
        if (hits.isEmpty()) return "";
        Object g = hits.get(0);
        Object lat = MiniJson.at(g, "latitude"), lon = MiniJson.at(g, "longitude");
        if (!(lat instanceof Double) || !(lon instanceof Double)) return "";
        StringBuilder name = new StringBuilder(String.valueOf(MiniJson.at(g, "name")));
        for (String k : new String[]{"admin1", "country"}) {
            Object v = MiniJson.at(g, k);
            if (v instanceof String && !name.toString().contains((String) v)) name.append(", ").append(v);
        }
        Object w = MiniJson.parse(get(String.format(java.util.Locale.ROOT,
            "https://api.open-meteo.com/v1/forecast?latitude=%.4f&longitude=%.4f&timezone=auto&forecast_days=3"
            + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m"
            + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            (Double) lat, (Double) lon), 100_000));
        Object now = MiniJson.at(w, "current"), daily = MiniJson.at(w, "daily");
        if (now == null) return "";
        StringBuilder b = new StringBuilder("Weather for ").append(name).append(" (live data from Open-Meteo");
        Object time = MiniJson.at(now, "time");
        if (time instanceof String && ((String) time).length() >= 16) b.append(", local time ").append(((String) time).substring(11, 16));
        b.append("). Now: ").append(deg(MiniJson.at(now, "temperature_2m"))).append(", feels like ")
            .append(deg(MiniJson.at(now, "apparent_temperature"))).append(", ").append(sky(MiniJson.at(now, "weather_code")));
        Object hum = MiniJson.at(now, "relative_humidity_2m"), wind = MiniJson.at(now, "wind_speed_10m");
        if (hum instanceof Double) b.append(", humidity ").append(Math.round((Double) hum)).append(" percent");
        if (wind instanceof Double) b.append(", wind ").append(Math.round((Double) wind)).append(" kilometres an hour");
        b.append('.');
        String[] days = {"Today", "Tomorrow", "The day after"};
        for (int i = 0; i < 3; i++) {
            Object hi = day(daily, "temperature_2m_max", i), lo = day(daily, "temperature_2m_min", i);
            if (!(hi instanceof Double)) break;
            b.append(' ').append(days[i]).append(": ").append(sky(day(daily, "weather_code", i))).append(", ")
                .append(deg(lo).replace(" degrees Celsius", "")).append(" to ").append(deg(hi));
            Object rain = day(daily, "precipitation_probability_max", i);
            if (rain instanceof Double) b.append(", chance of rain ").append(Math.round((Double) rain)).append(" percent");
            b.append('.');
        }
        sources.add(new Found("Open-Meteo weather for " + name, "https://open-meteo.com/", ""));
        return b.toString();
    }

    /** The first "value" of a wttr.in list such as weatherDesc or areaName. */
    private static String wv(Object o, String key) {
        List<?> l = MiniJson.list(MiniJson.at(o, key));
        Object v = l.isEmpty() ? null : MiniJson.at(l.get(0), "value");
        return v instanceof String ? ((String) v).trim() : "";
    }

    private static String ws(Object o, String key) {
        Object v = MiniJson.at(o, key);
        return v instanceof String ? (String) v : v instanceof Double ? String.valueOf(Math.round((Double) v)) : "";
    }

    private static String wttr(String place, List<Found> sources) throws IOException {
        Object w = MiniJson.parse(get("https://wttr.in/" + enc(place).replace("+", "%20") + "?format=j1", 400_000));
        List<?> cur = MiniJson.list(MiniJson.at(w, "current_condition"));
        if (cur.isEmpty()) return "";
        Object now = cur.get(0);
        List<?> area = MiniJson.list(MiniJson.at(w, "nearest_area"));
        StringBuilder name = new StringBuilder(place);
        if (!area.isEmpty()) {
            String region = wv(area.get(0), "region"), country = wv(area.get(0), "country");
            if (!region.isEmpty() && !region.equalsIgnoreCase(place)) name.append(", ").append(region);
            if (!country.isEmpty()) name.append(", ").append(country);
        }
        StringBuilder b = new StringBuilder("Weather for ").append(name).append(" (live data from wttr.in");
        String obs = ws(now, "localObsDateTime");
        if (obs.length() >= 16) b.append(", observed ").append(obs.substring(11));
        b.append("). Now: ").append(ws(now, "temp_C")).append(" degrees Celsius, feels like ").append(ws(now, "FeelsLikeC"))
            .append(" degrees Celsius, ").append(wv(now, "weatherDesc").toLowerCase())
            .append(", humidity ").append(ws(now, "humidity")).append(" percent, wind ").append(ws(now, "windspeedKmph"))
            .append(" kilometres an hour.");
        String[] days = {"Today", "Tomorrow", "The day after"};
        List<?> ahead = MiniJson.list(MiniJson.at(w, "weather"));
        for (int i = 0; i < Math.min(3, ahead.size()); i++) {
            Object d = ahead.get(i);
            List<?> hours = MiniJson.list(MiniJson.at(d, "hourly"));
            long rain = 0;
            String noon = "";
            for (int h = 0; h < hours.size(); h++) {
                try { rain = Math.max(rain, Long.parseLong(ws(hours.get(h), "chanceofrain"))); } catch (NumberFormatException e) { /* skip */ }
                if (h == hours.size() / 2) noon = wv(hours.get(h), "weatherDesc").toLowerCase();
            }
            b.append(' ').append(days[i]).append(": ").append(noon.isEmpty() ? "" : noon + ", ").append(ws(d, "mintempC"))
                .append(" to ").append(ws(d, "maxtempC")).append(" degrees Celsius, chance of rain ").append(rain).append(" percent.");
        }
        sources.add(new Found("wttr.in weather for " + name, "https://wttr.in/", ""));
        return b.toString();
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
            trouble("Wikipedia", e);   // offline or nothing found
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
    public static String notes(String query, int maxChars, List<Found> sources) { return notes(query, maxChars, sources, false); }

    /** With recent, the newest news on the subject comes first, each with its date. News, web and Wikipedia are asked at once. */
    public static String notes(String query, int maxChars, List<Found> sources, boolean recent) {
        List<String> via = Collections.synchronizedList(new ArrayList<>());
        AtomicReference<List<Found>> news = new AtomicReference<>(new ArrayList<>());
        AtomicReference<List<Found>> web = new AtomicReference<>(new ArrayList<>());
        AtomicReference<List<Found>> wiki = new AtomicReference<>(new ArrayList<>());
        List<Thread> asks = new ArrayList<>();
        if (recent) asks.add(new Thread(() -> news.set(searchNews(query, recent && keywords(query).isEmpty() ? 6 : 4, via))));
        if (!recent || !keywords(query).isEmpty()) {   // "what's in the news today" has no subject to look up elsewhere
            asks.add(new Thread(() -> web.set(searchWeb(query, 5, via))));
            asks.add(new Thread(() -> wiki.set(relevant(searchWikipedia(query, 1), query))));
        }
        for (Thread t : asks) { t.setDaemon(true); t.start(); }
        long deadline = System.currentTimeMillis() + 20_000;
        for (Thread t : asks) {
            try { t.join(Math.max(1, deadline - System.currentTimeMillis())); } catch (InterruptedException e) { break; }
        }

        StringBuilder b = new StringBuilder();
        for (Found f : news.get()) {
            b.append("- News: ").append(f.title).append(f.text.isEmpty() ? "" : " (" + f.text + ")").append('\n');
            sources.add(f);
        }
        for (Found f : web.get()) {
            if (f.text.isEmpty()) continue;
            b.append("- ").append(f.title).append(": ").append(f.text).append('\n');
            sources.add(f);
        }
        // the first page that reads well, for details the snippets leave out (two tries at most)
        int tries = 0;
        for (Found f : web.get()) {
            if (b.length() > maxChars * 2 / 3 || tries >= 2) break;
            if (f.url.contains("youtube.com") || f.url.endsWith(".pdf")) continue;
            tries++;
            String page = read(f.url, Math.min(1800, maxChars - b.length()));
            if (page.length() > 200) {
                b.append("From ").append(f.title).append(": ").append(page.replace('\n', ' ')).append('\n');
                break;
            }
        }
        if (b.length() < maxChars * 3 / 4 && (news.get().isEmpty() || web.get().isEmpty())) {
            for (Found w : wiki.get()) {
                b.append("Wikipedia, ").append(w.title).append(": ").append(w.text.replace('\n', ' ')).append('\n');
                sources.add(w);
                via.add("Wikipedia");
            }
        }
        synchronized (via) { lastVia = String.join(", ", via); }
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
