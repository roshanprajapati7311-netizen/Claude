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
import android.media.AudioManager
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
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
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
import org.json.JSONObject
import java.util.Locale

/**
 * Kaivra — the home screen is the holographic core (assets/core).
 * This native layer gives the core its voice (text-to-speech), its ears (speech recognition),
 * touch feedback, device access (contacts, calls, phone control) and the ability to open apps.
 */
class MainActivity : Activity(), TextToSpeech.OnInitListener {

    private lateinit var webView: WebView
    private lateinit var root: FrameLayout
    private val mainHandler = Handler(Looper.getMainLooper())
    private val prefs by lazy { getSharedPreferences("kaivra", Context.MODE_PRIVATE) }

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingSpeech: Pair<String, Boolean>? = null
    private var speechCount = 0
    private var listenAfterId: String? = null
    private var voices: List<Voice> = emptyList()
    private var voiceIndex = 0

    private var recognizer: SpeechRecognizer? = null

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
        tts = TextToSpeech(this, this)
    }

    @Suppress("DEPRECATION")
    private fun keyboardHeight(insets: WindowInsets): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) insets.getInsets(WindowInsets.Type.ime()).bottom
        else insets.systemWindowInsetBottom

    // ---------- voice (text-to-speech) ----------

    override fun onInit(status: Int) {
        if (status != TextToSpeech.SUCCESS) {
            sendToPage("error", "tts")
            return
        }
        val engine = tts ?: return
        voices = rankVoices(engine)
        val saved = prefs.getString("voice", null)
        val idx = voices.indexOfFirst { it.name == saved }
        voiceIndex = if (idx >= 0) idx else 0
        applyVoice(engine)
        engine.setPitch(1.0f)
        engine.setSpeechRate(0.95f)
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}
            override fun onDone(utteranceId: String?) {
                mainHandler.post { afterSpeech(utteranceId) }
            }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) {
                mainHandler.post { afterSpeech(utteranceId) }
            }
        })
        ttsReady = true
        pendingSpeech?.let { speakText(it.first, it.second) }
        pendingSpeech = null
    }

    /** English voices the phone has installed, best first: Indian English, then highest quality. */
    private fun rankVoices(engine: TextToSpeech): List<Voice> {
        val all: List<Voice> = try {
            engine.voices?.toList() ?: emptyList()
        } catch (e: Exception) {
            emptyList()
        }
        return all
            .filter { it.locale.language == "en" && it.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) != true }
            .sortedByDescending { voiceScore(it) }
            .take(12)
    }

    private fun voiceScore(v: Voice): Int {
        var s = when (v.locale.country) {
            "IN" -> 300
            "GB" -> 200
            "US" -> 100
            else -> 0
        }
        s += v.quality / 10
        if (!v.isNetworkConnectionRequired) s += 5
        return s
    }

    private fun applyVoice(engine: TextToSpeech) {
        val v = voices.getOrNull(voiceIndex)
        if (v != null) {
            engine.setVoice(v)
        } else {
            val result = engine.setLanguage(Locale.forLanguageTag("en-IN"))
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                engine.setLanguage(Locale.US)
            }
        }
    }

    private fun voiceLabel(): String {
        val v = voices.getOrNull(voiceIndex) ?: return "the phone's default voice"
        val accent = when (v.locale.country) {
            "IN" -> "Indian"
            "GB" -> "British"
            "US" -> "American"
            "AU" -> "Australian"
            else -> v.locale.displayCountry
        }
        val online = if (v.isNetworkConnectionRequired) ", online" else ""
        return "$accent English, voice ${voiceIndex + 1} of ${voices.size}$online"
    }

    private fun speakText(text: String, listenAfter: Boolean) {
        val engine = tts
        if (engine == null || !ttsReady) {
            pendingSpeech = Pair(text, listenAfter)
            return
        }
        recognizer?.cancel()
        speechCount += 1
        val id = "kaivra-$speechCount"
        listenAfterId = if (listenAfter) id else null
        sendToPage("speaking", text)
        engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, id)
    }

    private fun afterSpeech(id: String?) {
        sendToPage("spoken", id ?: "")
        if (id != null && id == listenAfterId) {
            listenAfterId = null
            startListening()
        }
    }

    // ---------- ears (speech recognition) ----------

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) { sendToPage("listening", "") }
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() { sendToPage("thinking", "") }
        override fun onError(error: Int) { sendToPage("error", error.toString()) }
        override fun onResults(results: Bundle?) {
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
            sendToPage("result", text)
        }
        override fun onPartialResults(partialResults: Bundle?) {
            val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: return
            if (text.isNotBlank()) sendToPage("partial", text)
        }
        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    private fun startListening() {
        if (!granted(Manifest.permission.RECORD_AUDIO)) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC)
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            sendToPage("error", "unavailable")
            return
        }
        val rec = recognizer ?: SpeechRecognizer.createSpeechRecognizer(this).also {
            it.setRecognitionListener(listener)
            recognizer = it
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        rec.cancel()
        rec.startListening(intent)
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

    private fun sendToPage(type: String, text: String) {
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
                listenAfterId = null
                pendingSpeech = null
                recognizer?.cancel()
                tts?.stop()
            }
        }

        /** Switches to the next installed voice and remembers it; returns a description of it. */
        @JavascriptInterface
        fun nextVoice(): String {
            val engine = tts ?: return ""
            if (voices.isEmpty()) return ""
            voiceIndex = (voiceIndex + 1) % voices.size
            applyVoice(engine)
            prefs.edit().putString("voice", voices[voiceIndex].name).apply()
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
        listenAfterId = null
        recognizer?.cancel()
        webView.onPause()
        webView.pauseTimers()
        super.onPause()
    }

    override fun onDestroy() {
        recognizer?.destroy()
        tts?.stop()
        tts?.shutdown()
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val REQ_MIC = 7
        private const val REQ_ACCESS = 8
    }
}
