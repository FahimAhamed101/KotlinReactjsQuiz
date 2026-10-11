package com.Fahim101.tomquiz.utils

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams

/**
 * Google Play Billing wrapper for a code-selling store.
 *
 * Design rules (these were the source of the original "it says verified but never charges" bug):
 *  1. [queryProductCatalog] queries EXACTLY [Constants.PLAY_PRODUCT_IDS] + the subscription.
 *     Nothing else, and never a hardcoded list that can drift from the UI catalog.
 *  2. There is NO simulated / mock purchase path. If a product cannot be resolved, the caller
 *     gets [onProductUnavailable] with an actionable reason instead of a fake success.
 *  3. One-time products are ACKNOWLEDGED (not consumed) so a paid code stays owned forever and
 *     can be restored after a reinstall via [restorePurchases].
 */
class BillingManager(
    private val activity: Activity,
    private val onPurchaseSuccess: (productId: String, purchaseToken: String, orderId: String) -> Unit,
    private val onPurchaseFailed: (errorMessage: String) -> Unit,
    private val onPurchasePending: (productId: String) -> Unit = {},
    private val onProductUnavailable: (productId: String, reason: String) -> Unit = { _, _ -> },
    private val onCatalogStateChanged: (isReady: Boolean, statusText: String) -> Unit = { _, _ -> }
) : PurchasesUpdatedListener {

    private val tag = "BillingManager"
    private val mainHandler = Handler(Looper.getMainLooper())
    private val billingClient: BillingClient

    private val productDetailsMap = mutableMapOf<String, ProductDetails>()

    /** Products Google Play explicitly told us it does not have (missing / inactive / unpublished). */
    private val missingProductIds = mutableSetOf<String>()

    private var reconnectAttempts = 0

    @Volatile
    private var isReady = false

    private companion object {
        const val MAX_RECONNECT_ATTEMPTS = 4
        const val BASE_RETRY_DELAY_MS = 1500L
    }

    init {
        val pendingPurchasesParams = PendingPurchasesParams.newBuilder()
            .enableOneTimeProducts()
            .build()

        billingClient = BillingClient.newBuilder(activity)
            .setListener(this)
            .enablePendingPurchases(pendingPurchasesParams)
            .enableAutoServiceReconnection()
            .build()

        startConnection()
    }

    // ------------------------------------------------------------------
    // Connection
    // ------------------------------------------------------------------

    private fun startConnection() {
        billingClient.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(billingResult: BillingResult) {
                if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                    isReady = true
                    reconnectAttempts = 0
                    Log.d(tag, "Google Play Billing connected")
                    queryProductCatalog()
                    restorePurchases()
                } else {
                    isReady = false
                    val reason = describe(billingResult)
                    Log.e(tag, "Billing setup failed: $reason")
                    onCatalogStateChanged(false, "Google Play unavailable: $reason")
                    scheduleReconnect()
                }
            }

            override fun onBillingServiceDisconnected() {
                isReady = false
                Log.w(tag, "Billing service disconnected - scheduling reconnect")
                onCatalogStateChanged(false, "Reconnecting to Google Play…")
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            onCatalogStateChanged(
                false,
                "Could not reach Google Play. Check your connection, and make sure this build was installed from a Play track that has the products published."
            )
            return
        }
        reconnectAttempts++
        mainHandler.postDelayed({
            if (!billingClient.isReady) {
                Log.d(tag, "Reconnect attempt $reconnectAttempts")
                startConnection()
            }
        }, BASE_RETRY_DELAY_MS * reconnectAttempts)
    }

    // ------------------------------------------------------------------
    // Catalog
    // ------------------------------------------------------------------

    /**
     * Query the real product catalog. Splits INAPP and SUBS into separate calls because
     * Google Play rejects a mixed product list.
     */
    private fun queryProductCatalog() {
        queryOneTimeProducts()
        querySubscription()
    }

    private fun queryOneTimeProducts() {
        val products = Constants.PLAY_PRODUCT_IDS.map { productId ->
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(productId)
                .setProductType(BillingClient.ProductType.INAPP)
                .build()
        }

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(products)
            .build()

        billingClient.queryProductDetailsAsync(params) { billingResult, result ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                result.productDetailsList.forEach { details ->
                    productDetailsMap[details.productId] = details
                    missingProductIds.remove(details.productId)
                    Log.d(tag, "INAPP product live: ${details.productId}")
                }
                result.unfetchedProductList.forEach { unfetched ->
                    missingProductIds.add(unfetched.productId)
                    Log.e(
                        tag,
                        "INAPP product NOT purchasable: ${unfetched.productId} " +
                            "(status ${unfetched.statusCode}) - create + activate it in Play Console"
                    )
                }
                publishCatalogState()
            } else {
                val reason = describe(billingResult)
                Log.e(tag, "queryProductDetails(INAPP) failed: $reason")
                onCatalogStateChanged(false, "Google Play error: $reason")
            }
        }
    }

    private fun querySubscription() {
        val products = listOf(
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(Constants.SUBSCRIPTION_PRODUCT_ID)
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
        )

        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(products)
            .build()

        billingClient.queryProductDetailsAsync(params) { billingResult, result ->
            if (billingResult.responseCode == BillingClient.BillingResponseCode.OK) {
                result.productDetailsList.forEach { details ->
                    productDetailsMap[details.productId] = details
                    missingProductIds.remove(details.productId)
                    Log.d(tag, "SUBS product live: ${details.productId}")
                }
                result.unfetchedProductList.forEach { unfetched ->
                    missingProductIds.add(unfetched.productId)
                    Log.e(tag, "SUBS product NOT purchasable: ${unfetched.productId}")
                }
                publishCatalogState()
            } else {
                Log.e(tag, "queryProductDetails(SUBS) failed: ${describe(billingResult)}")
            }
        }
    }

    private fun publishCatalogState() {
        val loaded = productDetailsMap.size
        val expected = Constants.PLAY_PRODUCT_IDS.size + 1
        if (loaded == 0) {
            onCatalogStateChanged(
                false,
                "No products could be loaded from Google Play. This usually means the product IDs are not published on the track you installed from."
            )
        } else {
            onCatalogStateChanged(true, "$loaded of $expected products live on Google Play")
        }
    }

    // ------------------------------------------------------------------
    // Purchase flows
    // ------------------------------------------------------------------

    /**
     * Launch the Google Play purchase sheet for a one-time product.
     * Never falls back to a simulated success - if the product is not resolvable the
     * caller is told exactly what is wrong.
     */
    fun launchPurchaseFlow(productId: String, orderId: Int? = null) {
        if (!billingClient.isReady) {
            onProductUnavailable(
                productId,
                "Google Play Billing is not connected yet. Check your internet connection and try again in a moment."
            )
            return
        }

        val productDetails = productDetailsMap[productId]
        if (productDetails == null) {
            onProductUnavailable(productId, unavailableReason(productId))
            return
        }

        // Products created in the newer Play Console carry "purchase options", each with its
        // own offer token. Passing the token of the option being sold is required when more
        // than one option exists, and harmless for legacy products that have none.
        val offerToken = productDetails.oneTimePurchaseOfferDetails?.offerToken

        val productDetailsParams = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(productDetails)
            .apply {
                if (!offerToken.isNullOrBlank()) {
                    setOfferToken(offerToken)
                }
            }
            .build()

        val flowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(productDetailsParams))
            .apply {
                if (orderId != null && orderId > 0) {
                    setObfuscatedAccountId(orderId.toString())
                }
            }
            .build()

        val result = billingClient.launchBillingFlow(activity, flowParams)
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            onPurchaseFailed("Could not open Google Play checkout: ${describe(result)}")
        }
    }

    /** Launch the subscription purchase sheet. */
    fun launchSubscriptionFlow(subscriptionId: String = Constants.SUBSCRIPTION_PRODUCT_ID) {
        if (!billingClient.isReady) {
            onProductUnavailable(
                subscriptionId,
                "Google Play Billing is not connected yet. Check your internet connection and try again in a moment."
            )
            return
        }

        val productDetails = productDetailsMap[subscriptionId]
        if (productDetails == null) {
            onProductUnavailable(subscriptionId, unavailableReason(subscriptionId))
            return
        }

        val offerToken = productDetails.subscriptionOfferDetails?.firstOrNull()?.offerToken
        if (offerToken.isNullOrBlank()) {
            onProductUnavailable(
                subscriptionId,
                "The subscription \"$subscriptionId\" has no active base plan. Add a base plan in Play Console > Monetise > Subscriptions."
            )
            return
        }

        val flowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(
                listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(productDetails)
                        .setOfferToken(offerToken)
                        .build()
                )
            )
            .build()

        val result = billingClient.launchBillingFlow(activity, flowParams)
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            onPurchaseFailed("Could not open Google Play checkout: ${describe(result)}")
        }
    }

    private fun unavailableReason(productId: String): String {
        return if (missingProductIds.contains(productId)) {
            "Google Play does not have a purchasable product with the ID \"$productId\".\n\n" +
                "Fix it in Play Console:\n" +
                "1. Monetise > Products > In-app products\n" +
                "2. Create a product with the exact ID \"$productId\"\n" +
                "3. Set it to ACTIVE and give it a price\n" +
                "4. Make sure the app is published to a track your account can install from"
        } else {
            "Product \"$productId\" is still loading from Google Play. Please try again in a moment."
        }
    }

    // ------------------------------------------------------------------
    // Purchase results
    // ------------------------------------------------------------------

    override fun onPurchasesUpdated(billingResult: BillingResult, purchases: List<Purchase>?) {
        when {
            billingResult.responseCode == BillingClient.BillingResponseCode.OK && purchases != null -> {
                purchases.forEach { handlePurchase(it) }
            }

            billingResult.responseCode == BillingClient.BillingResponseCode.USER_CANCELED -> {
                onPurchaseFailed("Purchase cancelled")
            }

            billingResult.responseCode == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> {
                // Not an error: the user already owns it. Restore instead of showing a failure.
                restorePurchases()
            }

            else -> {
                onPurchaseFailed("Google Play Billing error: ${describe(billingResult)}")
            }
        }
    }

    private fun handlePurchase(purchase: Purchase) {
        val productId = purchase.products.firstOrNull()

        when (purchase.purchaseState) {
            Purchase.PurchaseState.PURCHASED -> {
                if (productId == null) {
                    Log.e(tag, "Purchase with no product ID, ignoring")
                    return
                }
                if (!isGenuine(purchase)) {
                    Log.e(tag, "Rejected suspicious purchase for $productId")
                    onPurchaseFailed(
                        "This purchase could not be verified. If you were charged, contact support with order ID ${purchase.orderId}."
                    )
                    return
                }
                if (purchase.isAcknowledged) {
                    deliver(purchase, productId)
                } else {
                    acknowledgeThenDeliver(purchase, productId)
                }
            }

            Purchase.PurchaseState.PENDING -> {
                Log.i(tag, "Purchase pending for $productId")
                onPurchasePending(productId ?: "unknown")
            }

            else -> Log.w(tag, "Unhandled purchase state ${purchase.purchaseState} for $productId")
        }
    }

    /**
     * Acknowledging is mandatory: Google Play automatically refunds and revokes any
     * purchase that is not acknowledged within 3 days.
     */
    private fun acknowledgeThenDeliver(purchase: Purchase, productId: String) {
        val params = AcknowledgePurchaseParams.newBuilder()
            .setPurchaseToken(purchase.purchaseToken)
            .build()

        billingClient.acknowledgePurchase(params) { result ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                Log.d(tag, "Acknowledged $productId")
                deliver(purchase, productId)
            } else {
                val reason = describe(result)
                Log.e(tag, "Acknowledge failed for $productId: $reason")
                onPurchaseFailed(
                    "Google Play could not confirm your purchase ($reason). " +
                        "It will be refunded automatically unless it is confirmed within 3 days."
                )
            }
        }
    }

    private fun deliver(purchase: Purchase, productId: String) {
        val orderId = purchase.orderId ?: "token:${purchase.purchaseToken.take(12)}"
        onPurchaseSuccess(productId, purchase.purchaseToken, orderId)
    }

    /**
     * Cheap local sanity check. Real receipt validation belongs on a server
     * (see /buycodeprobackend -> purchases.products.get) using the purchase token.
     */
    private fun isGenuine(purchase: Purchase): Boolean {
        if (purchase.purchaseToken.isBlank()) return false
        if (purchase.purchaseToken.startsWith("mock_")) return false
        return !purchase.signature.isNullOrBlank()
    }

    // ------------------------------------------------------------------
    // Restore
    // ------------------------------------------------------------------

    /**
     * Query what the user already owns.
     * One-time products are ACKNOWLEDGED and never consumed, so they survive reinstalls.
     */
    fun restorePurchases(onRestored: ((Set<String>) -> Unit)? = null) {
        if (!billingClient.isReady) {
            onRestored?.invoke(emptySet())
            return
        }

        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.INAPP)
            .build()

        billingClient.queryPurchasesAsync(params) { result, purchases ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                Log.e(tag, "queryPurchasesAsync(INAPP) failed: ${describe(result)}")
                mainHandler.post { onRestored?.invoke(emptySet()) }
                return@queryPurchasesAsync
            }

            val owned = mutableSetOf<String>()
            purchases.forEach { purchase ->
                if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED) {
                    if (!purchase.isAcknowledged) {
                        billingClient.acknowledgePurchase(
                            AcknowledgePurchaseParams.newBuilder()
                                .setPurchaseToken(purchase.purchaseToken)
                                .build()
                        ) { }
                    }
                    owned.addAll(purchase.products)
                }
            }

            Log.d(tag, "Restored ${owned.size} owned one-time product(s)")
            mainHandler.post { onRestored?.invoke(owned) }
        }
    }

    /**
     * Check whether the user currently has an active subscription.
     * An active subscription gives All-Access Pass access.
     */
    fun checkExistingSubscription(onStatus: ((isActive: Boolean) -> Unit)? = null) {
        if (!billingClient.isReady) {
            mainHandler.post { onStatus?.invoke(false) }
            return
        }

        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.SUBS)
            .build()

        billingClient.queryPurchasesAsync(params) { result, purchases ->
            if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                Log.e(tag, "queryPurchasesAsync(SUBS) failed: ${describe(result)}")
                mainHandler.post { onStatus?.invoke(false) }
                return@queryPurchasesAsync
            }

            val active = purchases.any { purchase ->
                purchase.products.contains(Constants.SUBSCRIPTION_PRODUCT_ID) &&
                    purchase.purchaseState == Purchase.PurchaseState.PURCHASED
            }

            purchases.forEach { purchase ->
                if (purchase.purchaseState == Purchase.PurchaseState.PURCHASED && !purchase.isAcknowledged) {
                    billingClient.acknowledgePurchase(
                        AcknowledgePurchaseParams.newBuilder()
                            .setPurchaseToken(purchase.purchaseToken)
                            .build()
                    ) { }
                }
            }

            Log.d(tag, "Active subscription: $active")
            mainHandler.post { onStatus?.invoke(active) }
        }
    }

    /** @deprecated kept for source compatibility, use [checkExistingSubscription]. */
    @Deprecated("Use checkExistingSubscription", ReplaceWith("checkExistingSubscription(onSubscriptionStatus)"))
    fun checkExistingPurchases(onSubscriptionStatus: ((isActive: Boolean) -> Unit)? = null) {
        checkExistingSubscription(onSubscriptionStatus)
    }

    // ------------------------------------------------------------------
    // Helpers used by the UI
    // ------------------------------------------------------------------

    fun isBillingReady(): Boolean = isReady

    /** True once Google Play returned real details for this product. */
    fun isProductAvailable(productId: String): Boolean = productDetailsMap.containsKey(productId)

    /** Real, localised price straight from Google Play (e.g. "$14.99" or "৳1,299.00"). */
    fun getFormattedPrice(productId: String): String? =
        productDetailsMap[productId]?.oneTimePurchaseOfferDetails?.formattedPrice

    /** Real, localised subscription price from Google Play. */
    fun getSubscriptionFormattedPrice(
        subscriptionId: String = Constants.SUBSCRIPTION_PRODUCT_ID
    ): String? = productDetailsMap[subscriptionId]
        ?.subscriptionOfferDetails
        ?.firstOrNull()
        ?.pricingPhases
        ?.pricingPhaseList
        ?.firstOrNull()
        ?.formattedPrice

    /** Re-query the catalog (used by the "Refresh" action). */
    fun refreshProducts() {
        if (billingClient.isReady) {
            queryProductCatalog()
        } else {
            startConnection()
        }
    }

    /** Product IDs Google Play said it does not have. Useful for a diagnostics screen. */
    fun getMissingProductIds(): Set<String> = missingProductIds.toSet()

    fun destroy() {
        mainHandler.removeCallbacksAndMessages(null)
        if (billingClient.isReady) {
            billingClient.endConnection()
        }
    }

    private fun describe(result: BillingResult): String {
        val code = when (result.responseCode) {
            BillingClient.BillingResponseCode.BILLING_UNAVAILABLE -> "BILLING_UNAVAILABLE (not installed from Play, or Play Services missing)"
            BillingClient.BillingResponseCode.DEVELOPER_ERROR -> "DEVELOPER_ERROR (product ID / type mismatch, or app signature not recognised)"
            BillingClient.BillingResponseCode.ITEM_UNAVAILABLE -> "ITEM_UNAVAILABLE (product not active or not published on this track)"
            BillingClient.BillingResponseCode.ITEM_NOT_OWNED -> "ITEM_NOT_OWNED"
            BillingClient.BillingResponseCode.SERVICE_DISCONNECTED -> "SERVICE_DISCONNECTED"
            BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE -> "SERVICE_UNAVAILABLE (network)"
            BillingClient.BillingResponseCode.NETWORK_ERROR -> "NETWORK_ERROR"
            BillingClient.BillingResponseCode.FEATURE_NOT_SUPPORTED -> "FEATURE_NOT_SUPPORTED"
            BillingClient.BillingResponseCode.USER_CANCELED -> "USER_CANCELED"
            BillingClient.BillingResponseCode.OK -> "OK"
            else -> "code ${result.responseCode}"
        }
        val debug = result.debugMessage.takeIf { it.isNotBlank() }?.let { " - $it" } ?: ""
        return "$code$debug"
    }
}
