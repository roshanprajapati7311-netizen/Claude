package com.kaivra.app

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Kaivra's online brain. Sends the conversation to Google Gemini (free key from Google AI Studio)
 * or to Claude (key starting with "sk-ant-") and returns the reply as JSON: {id, ok, text | error, detail}.
 * The key is stored only on the phone and never leaves it except to the chosen provider.
 */
object Brain {

    // tried in order; if a model is missing or out of free quota, the next one is used
    private val GEMINI_MODELS = listOf(
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-flash-latest",
        "gemini-3-flash-preview",
        "gemini-2.5-flash"
    )
    private const val CLAUDE_MODEL = "claude-haiku-5-5"

    class BrainError(val code: String, message: String) : Exception(message)

    fun ask(req: JSONObject): String {
        val out = JSONObject().put("id", req.optInt("id"))
        val key = req.optString("key").trim()
        if (key.isEmpty()) return out.put("ok", false).put("error", "nokey").toString()
        val system = req.optString("system")
        val history = req.optJSONArray("history") ?: JSONArray()
        return try {
            val text = if (key.startsWith("sk-ant-")) claude(key, system, history) else gemini(key, system, history)
            out.put("ok", true).put("text", text).toString()
        } catch (e: BrainError) {
            out.put("ok", false).put("error", e.code).put("detail", e.message ?: "").toString()
        } catch (e: Exception) {
            out.put("ok", false).put("error", "network").put("detail", e.message ?: "").toString()
        }
    }

    private fun gemini(key: String, system: String, history: JSONArray): String {
        val contents = JSONArray()
        for (i in 0 until history.length()) {
            val m = history.getJSONObject(i)
            val role = if (m.optString("role") == "assistant") "model" else "user"
            val parts = JSONArray().put(JSONObject().put("text", m.optString("text")))
            contents.put(JSONObject().put("role", role).put("parts", parts))
        }
        val body = JSONObject()
            .put("system_instruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", system))))
            .put("contents", contents)
            .toString()
        var lastError = BrainError("model", "no Gemini model answered")
        for (model in GEMINI_MODELS) {
            val (code, text) = post(
                "https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent",
                body,
                mapOf("x-goog-api-key" to key)
            )
            if (code == 200) {
                val parts = JSONObject(text).optJSONArray("candidates")
                    ?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts")
                val sb = StringBuilder()
                if (parts != null) {
                    for (i in 0 until parts.length()) {
                        val p = parts.optJSONObject(i) ?: continue
                        if (!p.optBoolean("thought")) sb.append(p.optString("text"))
                    }
                }
                val reply = sb.toString().trim()
                if (reply.isNotEmpty()) return reply
                lastError = BrainError("empty", "empty reply")
                continue
            }
            val msg = errorMessage(text)
            if (code == 401 || code == 403 || text.contains("API_KEY_INVALID") || text.contains("API key not valid")) {
                throw BrainError("badkey", msg)
            }
            lastError = when (code) {
                429 -> BrainError("limit", msg)
                400, 404 -> BrainError("model", msg)
                else -> BrainError("server", "HTTP $code $msg")
            }
        }
        throw lastError
    }

    private fun claude(key: String, system: String, history: JSONArray): String {
        val messages = JSONArray()
        for (i in 0 until history.length()) {
            val m = history.getJSONObject(i)
            val role = if (m.optString("role") == "assistant") "assistant" else "user"
            messages.put(JSONObject().put("role", role).put("content", m.optString("text")))
        }
        val body = JSONObject()
            .put("model", CLAUDE_MODEL)
            .put("max_tokens", 800)
            .put("system", system)
            .put("messages", messages)
            .toString()
        val (code, text) = post(
            "https://api.anthropic.com/v1/messages",
            body,
            mapOf("x-api-key" to key, "anthropic-version" to "2023-06-01")
        )
        if (code == 200) {
            val content = JSONObject(text).optJSONArray("content") ?: JSONArray()
            val sb = StringBuilder()
            for (i in 0 until content.length()) {
                val c = content.optJSONObject(i) ?: continue
                if (c.optString("type") == "text") sb.append(c.optString("text"))
            }
            val reply = sb.toString().trim()
            if (reply.isEmpty()) throw BrainError("empty", "empty reply")
            return reply
        }
        val msg = errorMessage(text)
        throw when {
            code == 401 || code == 403 -> BrainError("badkey", msg)
            code == 429 -> BrainError("limit", msg)
            text.contains("credit") -> BrainError("credit", msg)
            else -> BrainError("server", "HTTP $code $msg")
        }
    }

    private fun post(url: String, body: String, headers: Map<String, String>): Pair<Int, String> {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15000
            conn.readTimeout = 60000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            for ((k, v) in headers) conn.setRequestProperty(k, v)
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return Pair(code, text)
        } finally {
            conn.disconnect()
        }
    }

    private fun errorMessage(text: String): String =
        try {
            JSONObject(text).optJSONObject("error")?.optString("message") ?: text.take(200)
        } catch (e: Exception) {
            text.take(200)
        }
}
