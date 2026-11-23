package com.kaivra.app

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.FilterInputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.GZIPInputStream

/**
 * Kaivra's recorded voices: voice packs built by Kaivra's own code (brain/voice/build_units.py) from the free
 * CMU ARCTIC recordings (Carnegie Mellon University). Each is downloaded once from this project's voice-pack
 * branch and then kept on the phone, so speaking works offline.
 */
class VoicePacks(context: Context, private val emit: (String, String) -> Unit) {
    data class Voice(val id: String, val label: String)

    companion object {
        const val BASE = "https://raw.githubusercontent.com/roshanprajapati7311-netizen/Claude/voice-pack/"
        const val ROBOT = "robot"
        val VOICES = listOf(
            Voice("rms", "a man's voice, American"),
            Voice("ksp", "a man's voice, Indian English"),
            Voice("slt", "a woman's voice, American"),
            Voice(ROBOT, "my old built-in robot voice"))
    }

    private val dir = File(context.filesDir, "packs").apply { mkdirs() }
    @Volatile var downloading: String? = null
        private set

    fun file(id: String) = File(dir, "voice-$id.bin")

    fun ready(id: String) = id == ROBOT || file(id).let { it.isFile && it.length() > 1_000_000 }

    fun load(id: String): KaivraUnits? = try { KaivraUnits.open(file(id)) } catch (e: Throwable) { null }

    /** Downloads one voice in the background (about 45-50 MB); onDone(true) once it is on the phone. */
    fun download(id: String, onDone: (Boolean) -> Unit) {
        if (id == ROBOT || downloading != null) return
        downloading = id
        Thread {
            var ok = false
            try {
                val c = URL(BASE + "voice-$id.bin.gz").openConnection() as HttpURLConnection
                c.connectTimeout = 20000
                c.readTimeout = 60000
                c.instanceFollowRedirects = true
                c.setRequestProperty("User-Agent", "Kaivra")
                if (c.responseCode !in 200..299) throw IOException("HTTP ${c.responseCode}")
                val total = c.contentLengthLong
                var got = 0L
                var last = 0L
                val counted = object : FilterInputStream(c.inputStream) {
                    override fun read(b: ByteArray, off: Int, len: Int): Int {
                        val r = super.read(b, off, len)
                        if (r > 0) {
                            got += r
                            val now = System.currentTimeMillis()
                            if (now - last > 500) {
                                last = now
                                emit("voicepack", JSONObject().put("id", id).put("done", got).put("total", total).toString())
                            }
                        }
                        return r
                    }
                }
                val tmp = File(dir, "voice-$id.bin.download")
                GZIPInputStream(counted.buffered(1 shl 16), 1 shl 16).use { input: InputStream ->
                    FileOutputStream(tmp).use { input.copyTo(it, 1 shl 16) }
                }
                val target = file(id)
                if (!tmp.renameTo(target)) {
                    target.delete()
                    if (!tmp.renameTo(target)) throw IOException("could not install voice")
                }
                ok = true
            } catch (e: Exception) {
                File(dir, "voice-$id.bin.download").delete()
            } finally {
                downloading = null
            }
            emit("voicepack", JSONObject().put("id", id).put("ready", ok).toString())
            onDone(ok)
        }.start()
    }
}
