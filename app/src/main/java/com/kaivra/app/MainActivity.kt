package com.kaivra.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.graphics.Color
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.util.Locale

/**
 * Kaivra — the home screen is the holographic core (assets/core).
 * This native layer gives the core its voice (text-to-speech), its ears (speech recognition),
 * touch feedback (vibration), the battery level and the ability to open apps.
 */
class MainActivity : Activity(), TextToSpeech.OnInitListener {

    private lateinit var webView: WebView
    private val mainHandler = Handler(Looper.getMainLooper())

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingSpeech: Pair<String, Boolean>? = null
    private var speechCount = 0
    private var listenAfterId: String? = null

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
        setContentView(webView)

        enterImmersive()
        tts = TextToSpeech(this, this)
    }

    // ---------- voice (text-to-speech) ----------

    override fun onInit(status: Int) {
        if (status != TextToSpeech.SUCCESS) {
            sendToPage("error", "tts")
            return
        }
        val engine = tts ?: return
        // Kaivra's voice: an offline Indian-English voice if the phone has one
        val voice = try {
            engine.voices
                ?.filter { it.locale.language == "en" && it.locale.country == "IN" && !it.isNetworkConnectionRequired }
                ?.minByOrNull { it.name }
        } catch (e: Exception) {
            null
        }
        if (voice != null) {
            engine.setVoice(voice)
        } else {
            val result = engine.setLanguage(Locale.forLanguageTag("en-IN"))
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                engine.setLanguage(Locale.US)
            }
        }
        engine.setPitch(0.9f)
        engine.setSpeechRate(1.0f)
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
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
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

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_MIC) return
        if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startListening()
        } else {
            sendToPage("error", "permission")
        }
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
            mainHandler.post { startActivity(launch) }
            return hit.loadLabel(packageManager).toString()
        }

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME
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
    }
}
