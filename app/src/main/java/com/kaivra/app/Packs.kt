package com.kaivra.app

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.DigestInputStream
import java.security.MessageDigest
import java.util.zip.GZIPInputStream
import java.util.zip.ZipInputStream

/**
 * Kaivra's own parts, downloaded once (and updated after each training night) from this project's
 * GitHub release "kaivra-packs": the small brain (brain.bin), the knowledge library (library.bin), the hearing model
 * and the thinking brain (mind.gguf, the open Qwen3.5 model, about 1.3 GB; its download continues where it stopped).
 * Everything is stored inside the app and works offline afterwards.
 */
class Packs(private val activity: MainActivity, private val emit: (String, String) -> Unit) {
    companion object {
        const val BASE = "https://github.com/roshanprajapati7311-netizen/Claude/releases/download/kaivra-packs/"
        val NAMES = listOf("mind", "brain", "library", "hearing")
    }

    private val prefs = activity.getSharedPreferences("kaivra", Context.MODE_PRIVATE)
    private val dir = File(activity.filesDir, "packs").apply { mkdirs() }
    @Volatile private var busy = false
    @Volatile private var manifest: JSONObject? = null
    @Volatile private var lastError = ""

    fun brainFile(): File? = File(dir, "brain.bin").takeIf { it.isFile && it.length() > 0 }
    fun libraryFile(): File? = File(dir, "library.bin").takeIf { it.isFile && it.length() > 0 }
    fun mindFile(): File? = File(dir, "mind.gguf").takeIf { it.isFile && it.length() > 100_000_000 }

    /** The folder of the hearing model (the one that holds its "am" or "conf" folder). */
    fun hearingModelDir(): File? {
        val top = File(dir, "hearing")
        if (!top.isDirectory) return null
        fun isModel(f: File) = File(f, "am").isDirectory || File(f, "conf").isDirectory
        if (isModel(top)) return top
        return top.listFiles()?.firstOrNull { it.isDirectory && isModel(it) }
    }

    private fun ready(name: String) = when (name) {
        "brain" -> brainFile() != null
        "library" -> libraryFile() != null
        "mind" -> mindFile() != null
        else -> hearingModelDir() != null
    }

    fun status(): JSONObject {
        val o = JSONObject()
        val m = manifest
        for (n in NAMES) {
            val p = JSONObject()
            p.put("ready", ready(n))
            p.put("installed", prefs.getLong("pack.$n", 0))
            val info = prefs.getString("packinfo.$n", null)
            if (info != null) p.put("info", JSONObject(info))
            val a = m?.optJSONObject(n)
            if (a != null) {
                p.put("available", a.optLong("version"))
                p.put("bytes", a.optLong("bytes"))
                p.put("latest", a)
            }
            o.put(n, p)
        }
        o.put("busy", busy)
        o.put("checked", m != null)
        if (lastError.isNotEmpty()) o.put("error", lastError)
        return o
    }

    fun check() {
        Thread {
            try { fetchManifest(); lastError = "" } catch (e: Exception) { lastError = "offline" }
            emit("packs", status().toString())
        }.start()
    }

    /** packs.json (small brain, library, hearing) and mind.json (the thinking brain), whichever exist yet. */
    private fun fetchManifest(): JSONObject {
        var found = false
        val m = try {
            JSONObject(String(get(BASE + "packs.json").use { it.readBytes() }, Charsets.UTF_8)).also { found = true }
        } catch (e: IOException) {
            if (e.message != "notyet") throw e
            JSONObject()
        }
        try {
            m.put("mind", JSONObject(String(get(BASE + "mind.json").use { it.readBytes() }, Charsets.UTF_8)))
            found = true
        } catch (e: IOException) {
            if (e.message != "notyet") throw e
        }
        if (!found) throw IOException("notyet")
        manifest = m
        return m
    }

    /** Opens a download; from > 0 asks for the rest of a file (the answer is 206 if the server can continue it). */
    private fun open(url: String, from: Long = 0): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 20000
        c.readTimeout = 60000
        c.instanceFollowRedirects = true
        c.setRequestProperty("User-Agent", "Kaivra")
        if (from > 0) c.setRequestProperty("Range", "bytes=$from-")
        val code = c.responseCode
        if (code == 404) throw IOException("notyet")
        if (code !in 200..299) throw IOException("HTTP $code")
        return c
    }

    private fun get(url: String): InputStream = open(url).inputStream

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        DigestInputStream(file.inputStream().buffered(1 shl 16), md).use { input ->
            val buf = ByteArray(1 shl 16)
            while (input.read(buf) >= 0) { /* reading feeds the digest */ }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    fun download() {
        if (busy) return
        busy = true
        lastError = ""
        emit("packs", status().toString())
        Thread {
            var changed = emptyList<String>()
            try {
                val m = fetchManifest()
                val todo = NAMES.filter { n ->
                    val a = m.optJSONObject(n)
                    a != null && (prefs.getLong("pack.$n", 0) != a.optLong("version") || !ready(n))
                }
                val total = todo.sumOf { m.getJSONObject(it).optLong("bytes") }
                var done = 0L
                var lastEmit = 0L
                if (dir.usableSpace < total + 300_000_000L) throw IOException("space")
                for (n in todo) {
                    val a = m.getJSONObject(n)
                    val tmp = File(dir, "$n.download")
                    // a big download that stopped half-way continues, if it is still the same version
                    val partKey = "partial.$n"
                    var have = if (tmp.isFile && prefs.getLong(partKey, -1) == a.optLong("version") && tmp.length() < a.optLong("bytes")) tmp.length() else 0L
                    if (have == 0L) tmp.delete()
                    prefs.edit().putLong(partKey, a.optLong("version")).apply()
                    val c = open(BASE + a.getString("file"), have)
                    if (have > 0 && c.responseCode != 206) have = 0L   // the server sent the whole file again
                    c.inputStream.use { input ->
                        FileOutputStream(tmp, have > 0).use { out ->
                            val buf = ByteArray(64 * 1024)
                            var got = have
                            while (true) {
                                val r = input.read(buf)
                                if (r < 0) break
                                out.write(buf, 0, r)
                                got += r
                                val now = System.currentTimeMillis()
                                if (now - lastEmit > 300) {
                                    lastEmit = now
                                    emit("packs", status().put("progress", JSONObject().put("name", n).put("done", done + got).put("total", total)).toString())
                                }
                            }
                        }
                    }
                    val hash = sha256(tmp)
                    if (a.has("sha256") && !hash.equals(a.getString("sha256"), ignoreCase = true)) {
                        tmp.delete()
                        throw IOException("damaged")
                    }
                    install(n, tmp)
                    tmp.delete()
                    prefs.edit().putLong("pack.$n", a.optLong("version")).putString("packinfo.$n", a.toString()).apply()
                    done += a.optLong("bytes")
                    changed = changed + n
                }
                lastError = ""
            } catch (e: Exception) {
                lastError = when (e.message) { "notyet" -> "notyet"; "damaged" -> "damaged"; "space" -> "space"; else -> "offline" }
            } finally {
                busy = false
            }
            if ("hearing" in changed) activity.hearingChanged()
            if ("brain" in changed || "library" in changed || "mind" in changed) activity.loadBrain()
            emit("packs", status().put("finished", true).put("changed", changed.joinToString(",")).toString())
        }.start()
    }

    private fun install(name: String, file: File) {
        when (name) {
            "mind" -> {
                val target = File(dir, "mind.gguf")
                target.delete() // if the old one is open, it stays readable until it is closed
                if (!file.renameTo(target)) throw IOException("could not install mind")
            }
            "brain", "library" -> {
                val target = File(dir, "$name.bin")
                val fresh = File(dir, "$name.bin.new")
                GZIPInputStream(file.inputStream().buffered()).use { input -> FileOutputStream(fresh).use { input.copyTo(it, 64 * 1024) } }
                if (!fresh.renameTo(target)) {
                    target.delete()
                    if (!fresh.renameTo(target)) throw IOException("could not install $name")
                }
            }
            "hearing" -> {
                val fresh = File(dir, "hearing.new")
                fresh.deleteRecursively()
                fresh.mkdirs()
                val base = fresh.canonicalPath + File.separator
                ZipInputStream(file.inputStream().buffered()).use { zip ->
                    while (true) {
                        val e = zip.nextEntry ?: break
                        val out = File(fresh, e.name)
                        if (!out.canonicalPath.startsWith(base)) continue // ignore paths that try to leave the folder
                        if (e.isDirectory) out.mkdirs()
                        else {
                            out.parentFile?.mkdirs()
                            FileOutputStream(out).use { zip.copyTo(it, 64 * 1024) }
                        }
                    }
                }
                val target = File(dir, "hearing")
                target.deleteRecursively()
                if (!fresh.renameTo(target)) throw IOException("could not install hearing")
            }
        }
    }
}
