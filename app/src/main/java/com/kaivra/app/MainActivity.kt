package com.kaivra.app

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.graphics.Color
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.ContactsContract
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.Random
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Kaivra — the home screen is the holographic core (assets/core).
 * Everything Kaivra thinks, says and hears is its own and runs on the phone:
 *  - voice: KaivraVoice + KaivraUnits (recorded voices built by Kaivra's own code from the free CMU ARCTIC
 *    recordings, downloaded once by VoicePacks; the built-in synthesizer speaks until one is on the phone)
 *  - thinking brain: KaivraMind, the open Qwen3.5 model (Apache 2.0) run by the llama.cpp engine (MIT) through Kaivra's
 *    own bridge; it answers what it knows, searches the web with KaivraWeb when it does not, and reasons step by step
 *  - small brain: KaivraBrain (own neural network, trained from zero on GitHub) + KaivraLibrary (own knowledge library)
 *  - hearing: the open-source Vosk engine (offline)
 * Brains, library and hearing are downloaded once from this project's own GitHub release (Packs.kt).
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView
    private lateinit var root: FrameLayout
    private val mainHandler = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("kaivra", Context.MODE_PRIVATE) }

    // voice
    private val voice = KaivraVoice()
    private val speechExec = Executors.newSingleThreadExecutor()
    private val speechToken = AtomicInteger(0)
    @Volatile private var currentTrack: AudioTrack? = null

    // hearing
    private var hearingModel: Model? = null
    private var hearingLoading = false
    private var speechService: SpeechService? = null
    private var recognizer: Recognizer? = null
    private var listenWhenReady = false

    // brain
    private val brainExec = Executors.newSingleThreadExecutor()
    @Volatile private var brain: KaivraBrain? = null
    @Volatile private var library: KaivraLibrary? = null
    @Volatile private var mind: KaivraMind? = null
    private val rng = Random()

    private lateinit var packs: Packs
    private lateinit var voicePacks: VoicePacks
    @Volatile private var voiceId = VoicePacks.DEFAULT

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val lp = window.attributes
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            window.attributes = lp
        }

        webView = WebView(this)
        webView.setBackgroundColor(Color.rgb(5, 3, 2))
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(KaivraBridge(), "KaivraNative")
        webView.loadUrl("file:///android_asset/core/index.html")

        // the page shrinks above the keyboard while typing
        root = FrameLayout(this)
        root.setBackgroundColor(Color.rgb(5, 3, 2))
        root.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.setOnApplyWindowInsetsListener { v, insets ->
            v.setPadding(0, 0, 0, keyboardHeight(insets))
            insets
        }
        setContentView(root)
        enterImmersive()

        voice.setVoice(0)
        packs = Packs(this) { type, json -> sendToPage(type, json) }
        voicePacks = VoicePacks(this) { type, json -> sendToPage(type, json) }
        useVoice(prefs.getString("voice", VoicePacks.DEFAULT) ?: VoicePacks.DEFAULT)
        Thread {
            try {
                assets.open("voice/cmudict.dict").use { voice.loadDictionary(it) }
            } catch (e: Exception) {
                // no dictionary in this build: the voice uses its own spelling rules
            }
        }.start()
        loadBrain()
    }

    @Suppress("DEPRECATION")
    private fun keyboardHeight(insets: WindowInsets): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) insets.getInsets(WindowInsets.Type.ime()).bottom
        else insets.systemWindowInsetBottom

    // ---------- voice (Kaivra's own synthesizer) ----------

    private fun speakText(text: String, listenAfter: Boolean) {
        stopHearing()
        val token = speechToken.incrementAndGet()
        sendToPage("speaking", text)
        speechExec.execute {
            val pcm = try { voice.synthesize(text) } catch (e: Exception) { ShortArray(0) }
            if (token == speechToken.get() && pcm.isNotEmpty()) play(pcm, token)
            mainHandler.post {
                if (token == speechToken.get()) {
                    sendToPage("spoken", "")
                    if (listenAfter) startListening()
                }
            }
        }
    }

    private fun play(pcm: ShortArray, token: Int) {
        var track: AudioTrack? = null
        try {
            val rate = KaivraVoice.SR
            val minBuf = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
            track = AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(maxOf(minBuf, rate))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
            currentTrack = track
            track.play()
            var off = 0
            while (off < pcm.size && token == speechToken.get()) {
                val n = track.write(pcm, off, minOf(2048, pcm.size - off))
                if (n <= 0) break
                off += n
            }
            // let the last of the sound play out before listening again
            val deadline = System.currentTimeMillis() + 3000
            while (token == speechToken.get() && track.playbackHeadPosition < off && System.currentTimeMillis() < deadline) Thread.sleep(15)
        } catch (e: Exception) {
            sendToPage("error", "tts")
        } finally {
            try { track?.stop() } catch (e: Exception) {}
            try { track?.release() } catch (e: Exception) {}
            if (currentTrack === track) currentTrack = null
        }
    }

    private fun stopSpeaking() {
        speechToken.incrementAndGet()
        try { currentTrack?.pause(); currentTrack?.flush() } catch (e: Exception) {}
    }

    /** Switches to one of Kaivra's voices: a recorded one (downloaded once) or the built-in robot voice. */
    private fun useVoice(id: String) {
        voiceId = if (VoicePacks.VOICES.any { it.id == id }) id else VoicePacks.DEFAULT
        prefs.edit().putString("voice", voiceId).apply()
        val wanted = voiceId
        if (wanted == VoicePacks.ROBOT) { voice.setUnits(null); return }
        if (voicePacks.ready(wanted)) {
            Thread { val u = voicePacks.load(wanted); if (voiceId == wanted) voice.setUnits(u) }.start()
        } else {
            voice.setUnits(null) // the built-in voice speaks until the recorded one is here
            voicePacks.download(wanted) { ok ->
                if (voiceId == wanted) {
                    if (ok) voice.setUnits(voicePacks.load(wanted))
                } else if (!voicePacks.ready(voiceId)) {
                    mainHandler.post { useVoice(voiceId) } // the choice changed meanwhile: get that one
                }
            }
        }
    }

    private fun voiceLabel(): String {
        val v = VoicePacks.VOICES.firstOrNull { it.id == voiceId } ?: VoicePacks.VOICES[0]
        val extra = if (voicePacks.ready(v.id)) "" else ", which I am downloading now, about 45 megabytes. Until it arrives you will hear my old robot voice"
        return v.label + extra + ", voice " + (VoicePacks.VOICES.indexOf(v) + 1) + " of " + VoicePacks.VOICES.size
    }

    // ---------- hearing (open-source Vosk, offline) ----------

    private fun hearingFolder(): File? = packs.hearingModelDir()

    private fun startListening() {
        if (!granted(Manifest.permission.RECORD_AUDIO)) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
            return
        }
        val model = hearingModel
        if (model != null) { beginListening(model); return }
        val dir = hearingFolder()
        if (dir == null) { sendToPage("error", "nohearing"); return }
        listenWhenReady = true
        if (hearingLoading) return
        hearingLoading = true
        sendToPage("thinking", "")
        Thread {
            val m = try { Model(dir.absolutePath) } catch (e: Throwable) { null }
            mainHandler.post {
                hearingLoading = false
                hearingModel = m
                if (m == null) sendToPage("error", "nohearing")
                else if (listenWhenReady) { listenWhenReady = false; beginListening(m) }
            }
        }.start()
    }

    private fun beginListening(model: Model) {
        stopHearing()
        try {
            val rec = Recognizer(model, 16000f)
            val svc = SpeechService(rec, 16000f)
            recognizer = rec
            speechService = svc
            svc.startListening(hearingListener, 9000)
            sendToPage("listening", "")
        } catch (e: Throwable) {
            stopHearing()
            sendToPage("error", "unavailable")
        }
    }

    private fun heardText(json: String?, key: String): String =
        try { JSONObject(json ?: "{}").optString(key, "").trim() } catch (e: Exception) { "" }

    private val hearingListener = object : RecognitionListener {
        override fun onPartialResult(hypothesis: String?) {
            val t = heardText(hypothesis, "partial")
            if (t.isNotEmpty()) sendToPage("partial", t)
        }
        override fun onResult(hypothesis: String?) {
            val t = heardText(hypothesis, "text")
            if (t.isNotEmpty() && speechService != null) {
                stopHearing()
                sendToPage("thinking", "")
                sendToPage("result", t)
            }
        }
        override fun onFinalResult(hypothesis: String?) {
            val t = heardText(hypothesis, "text")
            if (t.isNotEmpty() && speechService != null) {
                stopHearing()
                sendToPage("result", t)
            }
        }
        override fun onError(exception: Exception?) { stopHearing(); sendToPage("error", "1") }
        override fun onTimeout() { if (speechService != null) { stopHearing(); sendToPage("error", "6") } }
    }

    private fun stopHearing() {
        listenWhenReady = false
        val svc = speechService
        speechService = null
        if (svc != null) { try { svc.cancel() } catch (e: Throwable) {}; try { svc.shutdown() } catch (e: Throwable) {} }
        val rec = recognizer
        recognizer = null
        try { rec?.close() } catch (e: Throwable) {}
    }

    /** Called by Packs after a new hearing pack is installed. */
    fun hearingChanged() {
        mainHandler.post { stopHearing(); try { hearingModel?.close() } catch (e: Throwable) {}; hearingModel = null }
    }

    // ---------- brain (own neural network + knowledge library) ----------

    fun loadBrain() {
        brainExec.execute {
            brain = try { packs.brainFile()?.let { KaivraBrain(it) } } catch (e: Throwable) { null }
            library = try { packs.libraryFile()?.let { KaivraLibrary(it) } } catch (e: Throwable) { null }
            val old = mind
            mind = null
            try { old?.close() } catch (e: Throwable) {}
            // 4 threads: the phone's four fast cores
            mind = try { packs.mindFile()?.let { KaivraMind.open(it.path, 4, KaivraMind.CONTEXT) } } catch (e: Throwable) { null }
            mind?.let { md ->
                md.setMemory(savedList("rules"), savedList("notes"))
                md.setOwner(prefs.getString("owner.name", ""), prefs.getString("owner.call", ""))
            }
            sendToPage("packs", packs.status().toString())
        }
    }

    // ---------- Kaivra's memory: the owner, rules and notes, kept only on this phone ----------

    private fun savedList(key: String): List<String> {
        val out = ArrayList<String>()
        try {
            val a = JSONArray(prefs.getString(key, "[]"))
            for (i in 0 until a.length()) out.add(a.optString(i))
        } catch (e: Exception) {}
        return out
    }

    private fun saveList(key: String, items: List<String>) {
        val a = JSONArray()
        for (r in items) a.put(r)
        prefs.edit().putString(key, a.toString()).apply()
    }

    private fun saveMemory(md: KaivraMind) {
        saveList("rules", md.rules())
        saveList("notes", md.notes())
        val o = md.owner()
        prefs.edit().putString("owner.name", o[0]).putString("owner.call", o[1]).apply()
    }

    /** Everything Kaivra remembers, in its structure: the owner, rules and notes (skills are added by the page). */
    private fun memoryJson(): String {
        val o = JSONObject()
        o.put("owner", JSONObject().put("name", prefs.getString("owner.name", "")).put("call", prefs.getString("owner.call", "")))
        o.put("rules", JSONArray(savedList("rules")))
        o.put("notes", JSONArray(savedList("notes")))
        return o.toString()
    }

    /** Removes one item the owner chose on the memory screen: kind is owner, rules or notes. */
    private fun forgetMemory(kind: String, index: Int) {
        when (kind) {
            "owner" -> prefs.edit().putString("owner.name", "").putString("owner.call", "").apply()
            "rules", "notes" -> {
                val items = ArrayList(savedList(kind))
                if (index in items.indices) items.removeAt(index)
                saveList(kind, items)
            }
        }
        brainExec.execute {
            mind?.let { md ->
                md.setMemory(savedList("rules"), savedList("notes"))
                md.setOwner(prefs.getString("owner.name", ""), prefs.getString("owner.call", ""))
            }
        }
    }

    // ---------- skills: routines the owner teaches and plugins from the owner's GitHub ----------

    private fun download(url: String, max: Int): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10000
        c.readTimeout = 15000
        c.setRequestProperty("User-Agent", "Kaivra")
        val code = c.responseCode
        if (code !in 200..299) throw IOException("HTTP $code")
        val bytes = c.inputStream.use { it.readBytes() }
        return String(if (bytes.size > max) bytes.copyOf(max) else bytes, Charsets.UTF_8)
    }

    /** Downloads the plugins listed in skills/index.json on GitHub; the owner's own skills stay. Answers with a "skills" event. */
    private fun fetchSkills() {
        Thread {
            val res = JSONObject()
            try {
                val index = JSONObject(download(SKILLS + "index.json", 200_000))
                val have = JSONArray(prefs.getString("skills", "[]"))
                val kept = JSONArray()
                for (i in 0 until have.length()) {
                    val sk = have.optJSONObject(i) ?: continue
                    if (sk.optString("source") != "github") kept.put(sk)
                }
                val list = index.optJSONArray("skills") ?: JSONArray()
                var added = 0
                for (i in 0 until list.length()) {
                    val e = list.optJSONObject(i) ?: continue
                    val file = e.optString("file")
                    if (!file.matches(Regex("[A-Za-z0-9_-]+\\.js"))) continue
                    val code = download(SKILLS + file, 200_000)
                    kept.put(JSONObject().put("name", e.optString("name", file.removeSuffix(".js"))).put("kind", "plugin")
                        .put("source", "github").put("about", e.optString("about")).put("code", code))
                    added++
                }
                prefs.edit().putString("skills", kept.toString()).apply()
                res.put("ok", true).put("added", added).put("total", kept.length())
            } catch (e: Exception) {
                res.put("ok", false).put("error", if (e.message == "HTTP 404") "none" else "offline")
            }
            sendToPage("skills", res.toString())
        }.start()
    }

    /** A web page or API a skill asked for (https only); the answer arrives as an "http" event with the same id. */
    private fun httpGet(id: Int, url: String) {
        Thread {
            val res = JSONObject().put("id", id)
            try {
                if (!url.startsWith("https://")) throw IOException("https only")
                res.put("ok", true).put("text", download(url, 1_000_000))
            } catch (e: Exception) {
                res.put("ok", false).put("error", e.message ?: "offline")
            }
            sendToPage("http", res.toString())
        }.start()
    }

    private fun think(payload: String) {
        brainExec.execute {
            val out = JSONObject()
            try {
                val req = JSONObject(payload)
                out.put("id", req.optInt("id"))
                val question = req.optString("question")
                val history = ArrayList<Array<String>>()
                val h = req.optJSONArray("history") ?: JSONArray()
                for (i in 0 until h.length()) {
                    val pair = h.optJSONArray(i) ?: continue
                    history.add(arrayOf(pair.optString(0), pair.optString(1)))
                }
                val lib = library
                val b = brain
                val md = mind
                val hit = lib?.lookup(question)
                val fact = hit?.get(1)
                var text = ""
                if (md != null) {
                    // the thinking brain: answers, searches the web, or thinks it through
                    val ans = md.answer(question, history, fact, null)
                    if (ans.how == "rule" || ans.how == "note") saveMemory(md)
                    ans.skill?.let { out.put("skill", it) }
                    text = ans.text
                    out.put("how", ans.how)
                    if (ans.sources.isNotEmpty()) out.put("web", ans.sources[0].title)
                } else if (b != null) {
                    text = b.reply(question, history, fact, rng)
                    if (fact != null && !KaivraLibrary.agrees(text, fact)) text = KaivraLibrary.answerFrom(fact)
                } else if (fact != null) {
                    text = KaivraLibrary.answerFrom(fact)
                }
                if (text.isBlank()) {
                    out.put("ok", false).put("error", if (b == null && md == null) "nobrain" else "empty")
                } else {
                    out.put("ok", true).put("text", text).put("source", hit?.get(0) ?: "").put("own", md != null || b != null)
                }
            } catch (e: Throwable) {
                out.put("ok", false).put("error", "brain")
            }
            sendToPage("brain", out.toString())
        }
    }

    // ---------- device access ----------

    private fun granted(permission: String) = checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    private fun controlOn(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        return enabled.split(':').any { it.startsWith("$packageName/") }
    }

    private fun accessJson(): String {
        val o = JSONObject()
        o.put("mic", granted(Manifest.permission.RECORD_AUDIO))
        o.put("contacts", granted(Manifest.permission.READ_CONTACTS))
        o.put("phone", granted(Manifest.permission.CALL_PHONE))
        o.put("notifications", Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || granted(Manifest.permission.POST_NOTIFICATIONS))
        o.put("control", controlOn())
        return o.toString()
    }

    private fun runtimePermissions(): List<String> {
        val list = mutableListOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.READ_CONTACTS, Manifest.permission.CALL_PHONE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) list.add(Manifest.permission.POST_NOTIFICATIONS)
        return list
    }

    private fun askAccess(key: String) {
        val wanted: List<String> = when (key) {
            "mic" -> listOf(Manifest.permission.RECORD_AUDIO)
            "contacts" -> listOf(Manifest.permission.READ_CONTACTS)
            "phone" -> listOf(Manifest.permission.CALL_PHONE)
            "notifications" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) listOf(Manifest.permission.POST_NOTIFICATIONS) else emptyList()
            "all" -> runtimePermissions()
            "control" -> {
                openScreen(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                return
            }
            "appinfo" -> {
                openScreen(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
                return
            }
            else -> emptyList()
        }
        val missing = wanted.filter { !granted(it) }
        if (missing.isEmpty()) {
            sendToPage("access", accessJson())
            return
        }
        requestPermissions(missing.toTypedArray(), REQ_ACCESS)
    }

    private fun openScreen(intent: Intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
        } catch (e: Exception) {
            sendToPage("access", accessJson())
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_MIC) {
            if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                startListening()
            } else {
                sendToPage("error", "permission")
            }
        }
        sendToPage("access", accessJson())
    }

    /** A phone number spoken or typed directly, or the best match in the owner's contacts: (name, number). */
    private fun resolvePerson(who: String): Pair<String, String>? {
        val q = who.trim()
        if (q.count { it.isDigit() } >= 5) {
            val number = q.filter { it.isDigit() || it == '+' }
            return Pair(number, number)
        }
        if (q.isEmpty() || !granted(Manifest.permission.READ_CONTACTS)) return null
        var best: Pair<String, String>? = null
        var bestScore = 0
        try {
            val projection = arrayOf("display_name", "data1")
            val cursor = contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI, projection, "display_name LIKE ?", arrayOf("%$q%"), null
            )
            cursor?.use { c ->
                while (c.moveToNext()) {
                    val name = c.getString(0) ?: continue
                    val number = c.getString(1) ?: continue
                    val ln = name.lowercase()
                    val lq = q.lowercase()
                    val score = when {
                        ln == lq -> 3
                        ln.startsWith(lq) -> 2
                        else -> 1
                    }
                    if (score > bestScore) {
                        bestScore = score
                        best = Pair(name, number)
                    }
                }
            }
        } catch (e: Exception) {
            return null
        }
        return best
    }

    private fun personResult(who: String, act: (Pair<String, String>) -> String): String {
        val o = JSONObject()
        val person = resolvePerson(who)
        if (person == null) {
            val needsContacts = who.count { it.isDigit() } < 5 && !granted(Manifest.permission.READ_CONTACTS)
            o.put("status", if (needsContacts) "nocontacts" else "notfound")
            return o.toString()
        }
        o.put("status", act(person))
        o.put("name", person.first)
        return o.toString()
    }

    fun sendToPage(type: String, text: String) {
        val js = "window.KaivraVoice && window.KaivraVoice.onEvent(" + JSONObject.quote(type) + "," + JSONObject.quote(text) + ")"
        mainHandler.post { webView.evaluateJavascript(js, null) }
    }

    // ---------- bridge: what the core page can call as window.KaivraNative.* ----------

    inner class KaivraBridge {
        @JavascriptInterface
        fun speak(text: String) {
            mainHandler.post { speakText(text, false) }
        }

        @JavascriptInterface
        fun say(text: String, listenAfter: Boolean) {
            mainHandler.post { speakText(text, listenAfter) }
        }

        @JavascriptInterface
        fun listen() {
            mainHandler.post { startListening() }
        }

        @JavascriptInterface
        fun stop() {
            mainHandler.post {
                stopSpeaking()
                stopHearing()
            }
        }

        /** Switches to the next of Kaivra's voices and remembers it; returns its name. */
        @JavascriptInterface
        fun nextVoice(): String {
            val list = VoicePacks.VOICES
            val i = list.indexOfFirst { it.id == voiceId }
            useVoice(list[(i + 1) % list.size].id)
            return voiceLabel()
        }

        @JavascriptInterface
        fun voiceInfo(): String = voiceLabel()

        @JavascriptInterface
        fun accessStatus(): String = accessJson()

        @JavascriptInterface
        fun requestAccess(key: String) {
            mainHandler.post { askAccess(key) }
        }

        // Kaivra's own parts: brain, knowledge library, hearing
        @JavascriptInterface
        fun packsStatus(): String = packs.status().toString()

        @JavascriptInterface
        fun checkPacks() { packs.check() }

        @JavascriptInterface
        fun downloadPacks() { packs.download() }

        /** Everything Kaivra remembers about the owner (owner, rules, notes) as JSON. */
        @JavascriptInterface
        fun memory(): String = memoryJson()

        /** Removes one remembered item; returns the memory as it is now. */
        @JavascriptInterface
        fun forget(kind: String, index: Int): String {
            forgetMemory(kind, index)
            return memoryJson()
        }

        /** Kaivra's skills (routines the owner taught and plugins from GitHub) as JSON. */
        @JavascriptInterface
        fun skills(): String = prefs.getString("skills", "[]") ?: "[]"

        @JavascriptInterface
        fun saveSkills(json: String) { prefs.edit().putString("skills", json).apply() }

        @JavascriptInterface
        fun fetchSkills() { this@MainActivity.fetchSkills() }

        @JavascriptInterface
        fun httpGet(id: Int, url: String) { this@MainActivity.httpGet(id, url) }

        /** Asks Kaivra's own brain; the answer arrives as a "brain" event. */
        @JavascriptInterface
        fun think(payload: String) { this@MainActivity.think(payload) }

        @JavascriptInterface
        fun call(who: String): String = personResult(who) { person ->
            val direct = granted(Manifest.permission.CALL_PHONE)
            val intent = Intent(if (direct) Intent.ACTION_CALL else Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(person.second)))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            mainHandler.postDelayed({ startSafely(intent) }, 1200)
            if (direct) "calling" else "dialing"
        }

        @JavascriptInterface
        fun text(who: String, message: String): String = personResult(who) { person ->
            val intent = Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(person.second)))
            intent.putExtra("sms_body", message)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            mainHandler.postDelayed({ startSafely(intent) }, 1200)
            "composed"
        }

        /** Phone control through the accessibility service: home, back, recents, notifications, quicksettings, power, lock, screenshot. */
        @JavascriptInterface
        fun control(action: String): Boolean {
            val service = KaivraControlService.instance ?: return false
            val code = when (action) {
                "home" -> AccessibilityService.GLOBAL_ACTION_HOME
                "back" -> AccessibilityService.GLOBAL_ACTION_BACK
                "recents" -> AccessibilityService.GLOBAL_ACTION_RECENTS
                "notifications" -> AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS
                "quicksettings" -> AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS
                "power" -> AccessibilityService.GLOBAL_ACTION_POWER_DIALOG
                "lock" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN else return false
                "screenshot" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) AccessibilityService.GLOBAL_ACTION_TAKE_SCREENSHOT else return false
                else -> return false
            }
            mainHandler.postDelayed({ service.performGlobalAction(code) }, 900)
            return true
        }

        @JavascriptInterface
        fun torch(on: Boolean): Boolean {
            return try {
                val cm = getSystemService(Context.CAMERA_SERVICE) as CameraManager
                val id = cm.cameraIdList.firstOrNull {
                    cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
                } ?: return false
                cm.setTorchMode(id, on)
                true
            } catch (e: Exception) {
                false
            }
        }

        @JavascriptInterface
        fun volume(direction: Int) {
            val am = getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
            val adjust = if (direction > 0) AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER
            am.adjustStreamVolume(AudioManager.STREAM_MUSIC, adjust, AudioManager.FLAG_SHOW_UI)
        }

        @JavascriptInterface
        fun vibrate(ms: Int) {
            runOnUiThread { buzz(ms.toLong()) }
        }

        @JavascriptInterface
        fun battery(): Int {
            val bm = getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return -1
            return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        }

        /** Opens the installed app whose name best matches [name]; returns its name, or "" if none. */
        @JavascriptInterface
        fun openApp(name: String, strict: Boolean): String {
            val hit = findApp(name, strict) ?: return ""
            val launch = packageManager.getLaunchIntentForPackage(hit.activityInfo.packageName) ?: return ""
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            mainHandler.post { startSafely(launch) }
            return hit.loadLabel(packageManager).toString()
        }

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface
        fun openUrl(url: String) {
            if (!url.startsWith("https://")) return
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            mainHandler.post { startSafely(intent) }
        }
    }

    private fun startSafely(intent: Intent) {
        try {
            startActivity(intent)
        } catch (e: Exception) {
            sendToPage("error", "launch")
        }
    }

    @Suppress("DEPRECATION")
    private fun findApp(name: String, strict: Boolean): ResolveInfo? {
        val q = name.trim().lowercase()
        if (q.isEmpty()) return null
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        var best: ResolveInfo? = null
        var bestScore = 0
        for (ri in packageManager.queryIntentActivities(launcher, 0)) {
            if (ri.activityInfo.packageName == packageName) continue
            val label = ri.loadLabel(packageManager).toString().lowercase()
            val score = when {
                label == q -> 3
                label.startsWith(q) -> 2
                !strict && label.contains(q) -> 1
                else -> 0
            }
            if (score > bestScore) {
                bestScore = score
                best = ri
            }
        }
        return best
    }

    @Suppress("DEPRECATION")
    private fun buzz(ms: Long) {
        val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
            getSystemService(VIBRATOR_SERVICE) as? Vibrator
        }
        vibrator?.vibrate(VibrationEffect.createOneShot(ms.coerceIn(1L, 1000L), VibrationEffect.DEFAULT_AMPLITUDE))
    }

    @Suppress("DEPRECATION")
    private fun enterImmersive() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enterImmersive()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.resumeTimers()
        sendToPage("access", accessJson())
    }

    override fun onPause() {
        stopHearing()
        stopSpeaking()
        webView.onPause()
        webView.pauseTimers()
        super.onPause()
    }

    override fun onDestroy() {
        stopHearing()
        stopSpeaking()
        try { hearingModel?.close() } catch (e: Throwable) {}
        try { mind?.close() } catch (e: Throwable) {}
        speechExec.shutdownNow()
        brainExec.shutdownNow()
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        /** Where Kaivra's plugins live: the skills folder of the owner's GitHub repository. */
        const val SKILLS = "https://raw.githubusercontent.com/roshanprajapati7311-netizen/Claude/main/skills/"
        private const val REQ_MIC = 7
        private const val REQ_ACCESS = 8
    }
}
