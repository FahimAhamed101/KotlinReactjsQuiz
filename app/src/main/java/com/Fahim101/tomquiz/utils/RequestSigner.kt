package com.Fahim101.tomquiz.utils

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Request signing — the Android half of the server's VerifyRequestSignatureMiddleware.
 *
 * The canonical string is:
 *
 *     "{METHOD}|{path}|{X-Timestamp}|{X-Nonce}|{canonicalJson(body)}"
 *
 * where `path` is the URL path with no leading slash and **no query string**, and
 * `canonicalJson` re-encodes the body with keys sorted recursively so that key
 * order on the wire cannot change the signature.
 *
 * This must reproduce the server byte-for-byte. The server computes it with
 * `JSON.stringify` on the *parsed* body, so the two things that actually matter are:
 *
 *   1. **Key order** — Android's JSONObject preserves insertion order, so keys are
 *      sorted explicitly here.
 *   2. **Number formatting** — `JSON.stringify(5)` is `5`, not `5.0`. Integers are
 *      emitted verbatim and doubles lose a trailing `.0`.
 *
 * A `/` is deliberately *not* escaped, matching the server's `.replace(/\\\//g, '/')`.
 *
 * [signatureFor] takes an explicit timestamp and nonce precisely so the output can be
 * pinned in a unit test and compared against vectors produced by the server's own
 * `lib/signature.js`. See `RequestSignerTest`.
 *
 * Honest caveat: the key ships inside the APK, so this is not a defence against a
 * determined attacker who decompiles the app. What it does stop is anyone who
 * merely discovers the API URL from placing orders or draining coins with curl —
 * which is the realistic threat for a public endpoint.
 *
 * Uses `java.util.Base64` rather than `android.util.Base64` so it stays a pure-JVM
 * class and can be exercised by a plain unit test.
 */
object RequestSigner {

    private val secureRandom = SecureRandom()

    /**
     * Build the three signature headers for a request.
     *
     * @param method  "GET", "POST", …
     * @param path    the full request path, e.g. "/api/v6/me/orders?page=1"
     *                (the query is stripped here, as the server does)
     * @param body    the JSON body, or null for GET (the server signs GETs with `{}`)
     */
    fun headers(method: String, path: String, body: JSONObject?): Map<String, String> {
        val timestamp = (System.currentTimeMillis() / 1000).toString()
        val nonce = randomNonce()
        val signature = signatureFor(method, path, body, timestamp, nonce)

        return mapOf(
            "X-Signature" to signature,
            "X-Timestamp" to timestamp,
            "X-Nonce" to nonce
        )
    }

    /**
     * The deterministic core of [headers], with the timestamp and nonce pinned.
     * Exposed so a unit test can compare against the server's implementation.
     */
    fun signatureFor(
        method: String,
        path: String,
        body: JSONObject?,
        timestamp: String,
        nonce: String
    ): String {
        val signedPath = path.substringBefore('?').trimStart('/')
        val canonicalBody = canonicalJson(body ?: JSONObject())
        val payload = "$method|$signedPath|$timestamp|$nonce|$canonicalBody"
        return hmacSha256Hex(payload)
    }

    // ------------------------------------------------------------------
    // Canonical JSON — must match JavaScript's JSON.stringify
    // ------------------------------------------------------------------

    fun canonicalJson(value: Any?): String {
        val sb = StringBuilder()
        write(sb, value)
        return sb.toString()
    }

    private fun write(sb: StringBuilder, value: Any?) {
        // Every arm names `value` explicitly. A subject-less `when` with bare
        // `is X ->` arms does not compile — `is` needs a subject — and without the
        // explicit test there is no smart cast either, so `value.keys()` below
        // would resolve against Any? and fail.
        when {
            value == null || value === JSONObject.NULL -> sb.append("null")
            value is String -> writeString(sb, value)
            value is Boolean -> sb.append(if (value) "true" else "false")
            value is Int || value is Long || value is Short || value is Byte ->
                sb.append(value.toString())
            value is Double -> sb.append(jsNumber(value))
            value is Float -> sb.append(jsNumber(value.toDouble()))
            value is BigDecimal ->
                // Which type a decimal literal becomes depends on the org.json
                // build: Android's returns Double, the reference implementation
                // used by the unit tests returns BigDecimal. Without this branch
                // the value falls through to the String case and `1.5` is emitted
                // as the quoted `"1.5"`, which the server would reject. JS numbers
                // are doubles, so converting is the faithful canonicalisation.
                sb.append(jsNumber(value.toDouble()))
            value is JSONObject -> {
                // Sorted, because JSON.stringify emits insertion order and the two
                // sides would otherwise disagree whenever key order differs.
                val keys = value.keys().asSequence().sorted().toList()
                sb.append('{')
                keys.forEachIndexed { index, key ->
                    if (index > 0) sb.append(',')
                    writeString(sb, key)
                    sb.append(':')
                    write(sb, value.opt(key))
                }
                sb.append('}')
            }
            value is JSONArray -> {
                sb.append('[')
                for (i in 0 until value.length()) {
                    if (i > 0) sb.append(',')
                    write(sb, value.opt(i))
                }
                sb.append(']')
            }
            else -> writeString(sb, value.toString())
        }
    }

    /** JS escapes only `"`, `\` and control characters — never `/`. */
    private fun writeString(sb: StringBuilder, s: String) {
        sb.append('"')
        for (ch in s) {
            when (ch) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\b' -> sb.append("\\b")
                '\u000C' -> sb.append("\\f")
                else ->
                    if (ch < ' ') sb.append("\\u%04x".format(ch.code))
                    else sb.append(ch)
            }
        }
        sb.append('"')
    }

    /** `JSON.stringify(5.0)` is `5`; `JSON.stringify(1.5)` is `1.5`. */
    private fun jsNumber(d: Double): String = when {
        d.isNaN() || d.isInfinite() -> "null"
        d == d.toLong().toDouble() -> d.toLong().toString()
        else -> d.toString()
    }

    // ------------------------------------------------------------------
    // Crypto
    // ------------------------------------------------------------------

    private fun randomNonce(): String {
        val bytes = ByteArray(8)
        secureRandom.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    /** APP_KEY may be Laravel's `base64:...` form; decode it to raw bytes. */
    private fun appKeyBytes(): ByteArray {
        val raw = Constants.TTBOOST_APP_KEY
        if (raw.startsWith("base64:")) {
            return try {
                Base64.getDecoder().decode(raw.removePrefix("base64:"))
            } catch (e: Exception) {
                raw.toByteArray(Charsets.UTF_8)
            }
        }
        return raw.toByteArray(Charsets.UTF_8)
    }

    private fun hmacSha256Hex(payload: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(appKeyBytes(), "HmacSHA256"))
        return mac.doFinal(payload.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }
}
