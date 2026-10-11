package com.Fahim101.tomquiz.utils

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Client for the SocialBoost API (the Next.js service in /socialboostapi).
 *
 * Every call returns the standard envelope:
 *
 *   success -> { "success": true,  "data": ... }
 *   failure -> { "success": false, "error_code": "...", "message": "..." }
 *
 * so [call] unwraps `data` and throws [ApiException] on an error_code, which keeps
 * the call sites free of envelope handling.
 */
object SocialBoostApi {

    private const val TAG = "SocialBoostApi"
    private const val TIMEOUT_MS = 12_000

    /** One task in the Home feed. */
    data class TaskItem(
        val orderId: Int,
        val username: String,
        val imageUrl: String,
        val isLikes: Boolean,
        val rewardCoins: Int,
        val url: String,
        val postPk: String?
    )

    class ApiException(val errorCode: String, message: String?) : Exception(message ?: errorCode)

    /** GET /api/v6/me -> coins balance. */
    fun fetchCoins(token: String): Int {
        val data = call("GET", "/api/v6/me", null, token)
        return data.optJSONObject("user")?.optInt("coins", 0) ?: 0
    }

    /**
     * GET /api/v6/orders -> the task feed.
     *
     * `rewardCoins` comes from `preferences.follow` / `preferences.like`, which is
     * the same setting the server pays out — so the "+5" on the button is never a
     * hardcoded lie.
     */
    fun fetchTasks(token: String, secUid: String?, username: String?): List<TaskItem> {
        val query = buildString {
            append("/api/v6/orders?page=1")
            if (!secUid.isNullOrBlank()) append("&sec_uid=").append(secUid)
            if (!username.isNullOrBlank()) append("&username=").append(username)
        }

        val data = call("GET", query, null, token)
        val prefs = data.optJSONObject("preferences")
        val followReward = prefs?.optString("follow")?.toIntOrNull() ?: 5
        val likeReward = prefs?.optString("like")?.toIntOrNull() ?: 3

        val items = data.optJSONArray("items") ?: JSONArray()
        val tasks = mutableListOf<TaskItem>()

        for (i in 0 until items.length()) {
            val o = items.getJSONObject(i)
            val isLikes = o.optBoolean("is_likes", false)
            tasks.add(
                TaskItem(
                    orderId = o.optInt("id"),
                    username = o.optString("username", ""),
                    imageUrl = o.optString("image", ""),
                    isLikes = isLikes,
                    rewardCoins = if (isLikes) likeReward else followReward,
                    url = o.optString("url", ""),
                    postPk = o.optString("post_pk", "").ifBlank { null }
                )
            )
        }
        return tasks
    }

    /** One purchasable TikTok boost package in the Store. */
    data class BoostProduct(
        val id: Int,
        val actionCount: Int,
        val coinsPrice: Int?,
        val price: String?,
        val billingProductId: String?,
        val productType: String?,
        val off: Int?
    ) {
        /** Coin-priced products are paid from the balance; the rest are Play products. */
        val isCoinProduct: Boolean get() = coinsPrice != null
    }

    /**
     * GET /api/v6/products -> the Store carousel.
     *
     * `coins_price` non-null means the package is bought with coins; when it is
     * null the row is a Google Play product and `billing_product_id` is set.
     */
    fun fetchProducts(token: String): List<BoostProduct> {
        val arr = callArray("GET", "/api/v6/products", token)
        val out = mutableListOf<BoostProduct>()

        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            out.add(
                BoostProduct(
                    id = o.optInt("id"),
                    actionCount = o.optInt("action_count"),
                    coinsPrice = if (o.isNull("coins_price")) null else o.optInt("coins_price"),
                    price = o.optString("price", "").ifBlank { null },
                    billingProductId = o.optString("billing_product_id", "").ifBlank { null },
                    productType = o.optString("product_type", "").ifBlank { null },
                    off = if (o.isNull("off")) null else o.optInt("off")
                )
            )
        }
        return out
    }

    /** A source-code catalogue entry carrying the server's coin price. */
    data class CodeOffer(
        val codeId: String,
        val title: String,
        val coinsPrice: Int
    )

    /**
     * GET /api/v6/codes -> the coin price for every catalogue code.
     *
     * The price comes from the server and is never computed on the client, so a
     * tampered build cannot unlock a code for fewer coins.
     */
    fun fetchCodes(token: String): List<CodeOffer> {
        val arr = callArray("GET", "/api/v6/codes", token)
        val out = mutableListOf<CodeOffer>()

        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val codeId = o.optString("code_id", "")
            if (codeId.isBlank()) continue
            out.add(
                CodeOffer(
                    codeId = codeId,
                    title = o.optString("title", ""),
                    coinsPrice = o.optInt("coins_price", 0)
                )
            )
        }
        return out
    }

    /**
     * GET /api/v6/codes/unlocked -> the code ids this account already unlocked.
     *
     * This is the authoritative ownership list for coin unlocks; unlike a Google
     * Play purchase it has no Play-side record, so it must be re-fetched.
     */
    fun fetchUnlockedCodes(token: String): List<String> {
        val data = call("GET", "/api/v6/codes/unlocked", null, token)
        val arr = data.optJSONArray("code_ids") ?: JSONArray()
        val out = mutableListOf<String>()
        for (i in 0 until arr.length()) out.add(arr.optString(i))
        return out
    }

    /**
     * POST /api/v6/codes/unlock -> spend coins on a code.
     *
     * Idempotent server-side: calling it again returns `already = true` and
     * charges nothing, so a retry after a timeout is safe.
     */
    fun unlockCode(token: String, codeId: String): JSONObject {
        val body = JSONObject().apply { put("code_id", codeId) }
        return call("POST", "/api/v6/codes/unlock", body, token)
    }

    /**
     * POST /api/v6/orders -> place a coin-paid boost order for the caller's own
     * TikTok account. The server charges `coins_price` and returns the order.
     *
     * Only coin products are placed from the app. A Play-priced product would be
     * created Pending and only released by /payment/notify, which is not part of
     * this port — the Store blocks those instead of leaving a dangling order.
     */
    fun createOrder(
        token: String,
        secUid: String,
        username: String,
        url: String,
        productId: Int,
        postPk: String? = null
    ): JSONObject {
        val body = JSONObject().apply {
            put("sec_uid", secUid)
            // The server resolves the target by sec_uid first, then by username.
            // Sending both means a stale sec_uid still resolves instead of
            // failing with InvalidUsernameOrUrl.
            put("username", username)
            put("url", url)
            // requireString() on the server insists on a string here.
            put("product_id", productId.toString())
            if (!postPk.isNullOrBlank()) put("post_pk", postPk)
        }
        return call("POST", "/api/v6/orders", body, token)
    }

    /**
     * POST /api/v6/coins/check -> verify the action and credit coins.
     * @return coins earned (0 when nothing was credited)
     */
    fun verifyTask(
        token: String,
        orderId: Int,
        secUid: String?,
        ttUsername: String,
        targetUsername: String,
        isLikes: Boolean = false,
        actionCompleted: Boolean = true
    ): Int {
        val body = JSONObject().apply {
            put("order_id", orderId)
            if (!secUid.isNullOrBlank()) put("sec_uid", secUid)
            put("tt_username", ttUsername)
            put("tiktok_username", targetUsername)
            if (isLikes) {
                put("likes_incremented", actionCompleted)
            } else {
                put("follow_incremented", actionCompleted)
            }
        }

        val data = call("POST", "/api/v6/coins/check", body, token)
        return if (data.optBoolean("is_success", false)) data.optInt("coins_earned", 0) else 0
    }

    /** POST /api/v6/orders/skip-count -> stop serving this task. */
    fun skipTask(token: String, orderId: Int, secUid: String?, username: String?) {
        val body = JSONObject().apply {
            put("order_id", orderId)
            if (!secUid.isNullOrBlank()) put("sec_uid", secUid)
            if (!username.isNullOrBlank()) put("username", username)
        }
        call("POST", "/api/v6/orders/skip-count", body, token)
    }

    /**
     * POST /api/v6/payment/notify -> tell the server a Google Play purchase succeeded.
     *
     * The order was created as Pending first; this endpoint verifies the receipt with
     * Google Play and activates the order.
     */
    fun notifyPayment(token: String, orderId: Int, purchaseToken: String, googleOrderId: String?): JSONObject {
        val body = JSONObject().apply {
            put("order_id", orderId)
            put("purchase_token", purchaseToken)
            if (!googleOrderId.isNullOrBlank()) put("google_order_id", googleOrderId)
        }
        return call("POST", "/api/v6/payment/notify", body, token)
    }

    /**
     * POST /api/v6/login -> { auth: { token, expires_at }, user, preferences, tiktok_info }
     *
     * The login routes sit behind HashMiddleware, so they need the `hash` header
     * (sha256 of HASH_VALUE) — the same constant the server was configured with.
     */
    fun login(loginId: String, username: String, deviceName: String = "android"): JSONObject {
        val body = JSONObject().apply {
            put("device_name", deviceName)
            put("id", loginId)
            put("username", username)
        }
        val headers = mapOf("hash" to sha256Hex(Constants.TTBOOST_HASH_VALUE))
        return call("POST", "/api/v6/login", body, null, headers)
    }

    /**
     * POST /api/v6/register -> same shape as login.
     *
     * `is_emulator` is sent as false: an emulator signup is denied the welcome
     * bonus, and the server treats a missing flag as false anyway.
     */
    fun register(
        loginId: String,
        username: String,
        deviceName: String = "android",
        referral: String? = null
    ): JSONObject {
        val body = JSONObject().apply {
            put("device_name", deviceName)
            put("id", loginId)
            put("username", username)
            put("is_emulator", false)
            if (!referral.isNullOrBlank()) put("referral", referral)
        }
        val headers = mapOf("hash" to sha256Hex(Constants.TTBOOST_HASH_VALUE))
        return call("POST", "/api/v6/register", body, null, headers)
    }

    /** One row in the user's order history. */
    data class OrderHistoryItem(
        val id: Int,
        val username: String,
        val productType: String?,
        val actionCount: Int,
        val status: String,
        val isLikes: Boolean,
        val createdAt: String
    )

    /** One row in the coins ledger. */
    data class CoinHistoryItem(
        val id: Int,
        val type: String,
        val gain: Int,
        val lost: Int,
        val username: String?,
        val createdAt: String
    )

    /**
     * GET /api/v6/me/orders -> this user's own orders, newest first.
     *
     * The payload is a Laravel-shaped paginator, so the rows sit under `data`.
     */
    fun fetchMyOrders(token: String, page: Int = 1): List<OrderHistoryItem> {
        val payload = call("GET", "/api/v6/me/orders?page=$page", null, token)
        val arr = payload.optJSONArray("data") ?: JSONArray()
        val out = mutableListOf<OrderHistoryItem>()

        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            val product = o.optJSONObject("product")
            out.add(
                OrderHistoryItem(
                    id = o.optInt("id"),
                    username = o.optString("username", ""),
                    productType = product?.optString("product_type", "")?.ifBlank { null },
                    actionCount = product?.optInt("action_count", 0) ?: 0,
                    status = o.optString("status", ""),
                    isLikes = o.optBoolean("is_likes", false),
                    createdAt = o.optString("created_at", "")
                )
            )
        }
        return out
    }

    /** GET /api/v6/me/history -> the coins ledger, newest first. */
    fun fetchCoinHistory(token: String, page: Int = 1): List<CoinHistoryItem> {
        val payload = call("GET", "/api/v6/me/history?page=$page", null, token)
        val arr = payload.optJSONArray("data") ?: JSONArray()
        val out = mutableListOf<CoinHistoryItem>()

        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            out.add(
                CoinHistoryItem(
                    id = o.optInt("id"),
                    type = o.optString("type", ""),
                    gain = o.optInt("gain", 0),
                    lost = o.optInt("lost", 0),
                    username = o.optString("username", "").ifBlank { null },
                    createdAt = o.optString("created_at", "")
                )
            )
        }
        return out
    }

    // ------------------------------------------------------------------
    // Transport
    // ------------------------------------------------------------------

    private fun call(
        method: String,
        path: String,
        body: JSONObject?,
        token: String?,
        extraHeaders: Map<String, String> = emptyMap()
    ): JSONObject {
        val url = URL(Constants.TTBOOST_API_URL.trimEnd('/') + path)
        val conn = url.openConnection() as HttpURLConnection

        try {
            conn.requestMethod = method
            conn.connectTimeout = TIMEOUT_MS
            conn.readTimeout = TIMEOUT_MS
            conn.setRequestProperty("Accept", "application/json")
            extraHeaders.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")

            // Every v6 request must be signed. The server re-derives the canonical
            // string from the parsed body, so the wire key order does not matter.
            RequestSigner.headers(method, path, body).forEach { (k, v) ->
                conn.setRequestProperty(k, v)
            }

            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }

            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()

            if (text.isBlank()) {
                if (code in 200..299) return JSONObject()
                throw ApiException("Http$code", "Request failed ($code)")
            }

            val json = JSONObject(text)
            if (!json.optBoolean("success", false)) {
                val code2 = json.optString("error_code", "Unknown")
                val message = json.optString("message", "").ifBlank { null }
                Log.w(TAG, "API error $code2 on $method $path: $message")
                throw ApiException(code2, message)
            }

            // Most endpoints nest their payload under `data`; login returns it flat.
            return json.optJSONObject("data") ?: json
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Like [call], but for endpoints whose `data` is an array (e.g. /products).
     * [call] cannot be reused because `optJSONObject("data")` is null for arrays,
     * which would silently hand back the whole envelope instead of the payload.
     */
    private fun callArray(method: String, path: String, token: String?): JSONArray {
        val url = URL(Constants.TTBOOST_API_URL.trimEnd('/') + path)
        val conn = url.openConnection() as HttpURLConnection

        try {
            conn.requestMethod = method
            conn.connectTimeout = TIMEOUT_MS
            conn.readTimeout = TIMEOUT_MS
            conn.setRequestProperty("Accept", "application/json")
            if (token != null) conn.setRequestProperty("Authorization", "Bearer $token")

            // Array endpoints are GETs, so the signed body is the empty object the
            // server passes to verifySignature for bodyless routes.
            RequestSigner.headers(method, path, null).forEach { (k, v) ->
                conn.setRequestProperty(k, v)
            }

            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()

            if (text.isBlank()) {
                if (code in 200..299) return JSONArray()
                throw ApiException("Http$code", "Request failed ($code)")
            }

            val json = JSONObject(text)
            if (!json.optBoolean("success", false)) {
                val errorCode = json.optString("error_code", "Unknown")
                val message = json.optString("message", "").ifBlank { null }
                Log.w(TAG, "API error $errorCode on $method $path: $message")
                throw ApiException(errorCode, message)
            }

            return json.optJSONArray("data") ?: JSONArray()
        } finally {
            conn.disconnect()
        }
    }

    private fun sha256Hex(value: String): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        return digest.digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }
}
