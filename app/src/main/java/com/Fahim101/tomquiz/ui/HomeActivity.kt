package com.Fahim101.tomquiz.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.app.Dialog
import android.graphics.drawable.Drawable
import android.view.MotionEvent
import android.view.Window
import android.view.WindowManager
import android.widget.ProgressBar
import com.bumptech.glide.load.DataSource
import com.bumptech.glide.load.engine.DiskCacheStrategy
import com.bumptech.glide.load.engine.GlideException
import com.bumptech.glide.request.RequestListener
import com.bumptech.glide.request.target.Target
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import android.widget.ViewFlipper
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.Fahim101.tomquiz.R
import com.bumptech.glide.Glide
import com.Fahim101.tomquiz.model.CodeItem
import com.Fahim101.tomquiz.utils.Avatars
import com.Fahim101.tomquiz.utils.BillingManager
import com.Fahim101.tomquiz.utils.Constants
import com.Fahim101.tomquiz.utils.SocialBoostApi
import com.google.android.material.imageview.ShapeableImageView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class HomeActivity : AppCompatActivity() {

    private lateinit var prefs: SharedPreferences
    private lateinit var userName: String
    private var coinsBalance: Int = 250

    private lateinit var tvGreeting: TextView
    private lateinit var tvCoins: TextView
    private lateinit var viewFlipper: ViewFlipper

    // Bottom navigation. It lives in the shell layout, not in a screen, so it
    // stays visible whichever tab is showing.
    private lateinit var ivNavHome: ImageView
    private lateinit var tvNavHome: TextView
    private lateinit var ivNavBoost: ImageView
    private lateinit var tvNavBoost: TextView
    private lateinit var ivNavCodes: ImageView
    private lateinit var tvNavCodes: TextView
    private lateinit var ivNavMore: ImageView
    private lateinit var tvNavMore: TextView

    // Store: the TikTok boost carousel (coins) that sits above the code list.
    private lateinit var rvBoostProducts: RecyclerView
    private lateinit var boostAdapter: BoostAdapter
    private lateinit var progressBoost: android.widget.ProgressBar
    private lateinit var tvBoostEmpty: TextView
    private val boostProducts = mutableListOf<SocialBoostApi.BoostProduct>()
    private var layoutTopWordmark: View? = null
    private var tvTopScreenTitle: TextView? = null

    // More screen: profile, order history and the coins ledger.
    private lateinit var tvMoreUsername: TextView
    private lateinit var tvMoreCoins: TextView
    private lateinit var rvMyOrders: RecyclerView
    private lateinit var orderHistoryAdapter: OrderHistoryAdapter
    private lateinit var rvCoinHistory: RecyclerView
    private lateinit var coinHistoryAdapter: CoinHistoryAdapter
    private lateinit var progressOrders: android.widget.ProgressBar
    private lateinit var tvOrdersEmpty: TextView
    private lateinit var progressCoinHistory: android.widget.ProgressBar
    private lateinit var tvCoinHistoryEmpty: TextView
    private val orderHistory = mutableListOf<SocialBoostApi.OrderHistoryItem>()
    private val coinHistory = mutableListOf<SocialBoostApi.CoinHistoryItem>()

    // Tasks screen, second section: the buyer's own orders (same rows as More).
    private lateinit var taskOrderAdapter: TaskOrderAdapter
    private lateinit var rvTaskOrders: RecyclerView
    private var sectionTaskOrders: View? = null
    private lateinit var tvTaskOrdersCount: TextView
    private lateinit var tvTaskOrdersEmpty: TextView

    /** The histories are fetched lazily the first time More is opened. */
    private var hasLoadedMore = false

    // Daily free coins
    private var cardDailyReward: View? = null
    private var tvDailyRewardSubtitle: TextView? = null
    private var btnDailyClaim: android.widget.Button? = null
    private var dailyBonusState: SocialBoostApi.DailyBonus? = null
    private val dailyHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var dailyRunnable: Runnable = Runnable { }

    // Buy Codes UI
    private lateinit var rvBuyCodes: RecyclerView
    private lateinit var buyCodesAdapter: BuyCodesAdapter
    private var allCodesList = mutableListOf<CodeItem>()

    /** code id -> coin price, straight from the server. Empty until it answers. */
    private var codeCoinPrices: Map<String, Int> = emptyMap()

    // Filter Chips
    private lateinit var chipFilterAll: TextView
    private lateinit var chipFilterFullstack: TextView
    private lateinit var chipFilterMobile: TextView
    private lateinit var chipFilterFrontend: TextView
    private lateinit var chipFilterBackend: TextView

    // Google Play In-App Purchases Manager
    private lateinit var billingManager: BillingManager

    // Live references into the currently open purchase dialog
    private var activeDialog: AlertDialog? = null
    private var activeItem: CodeItem? = null
    private var activeCheckoutForm: LinearLayout? = null
    private var activeUnlockedLayout: LinearLayout? = null
    private var activeTitleHeader: TextView? = null
    private var activeBillingStatus: TextView? = null
    private var activeBuyButton: Button? = null
    private var activePriceLabel: TextView? = null
    private var activeDeliveryLabel: TextView? = null
    private var isSubscriptionSelected = false
    private var hasRestoredOwnedPurchases = false
    private var isSubscriptionActive = false

    // Pending Play order for boost products (followers/likes bought with money)
    private var pendingPlayOrderId: Int = 0

    // Subscription pricing views, kept in sync with Google Play's localised price
    private var tvSubPrice: TextView? = null
    private var tvSubBadge: TextView? = null
    private var tvSubTitle: TextView? = null
    private var tvSubSubtitle: TextView? = null
    private var btnSubscribe5Usd: Button? = null
    private var activeSubPriceLabel: TextView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_home)

        prefs = getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)

        // One-time cleanup: wipe legacy corrupted KEY_PURCHASED_IDS where all 17 codes
        // were mistakenly added due to the old subscription bug.
        if (!prefs.getBoolean(Constants.KEY_PURCHASES_PURGED_V2, false)) {
            prefs.edit()
                .remove(Constants.KEY_PURCHASED_IDS)
                .remove(Constants.KEY_IS_SUBSCRIPTION_ACTIVE)
                .putBoolean(Constants.KEY_PURCHASES_PURGED_V2, true)
                .apply()
        }

        isSubscriptionActive = prefs.getBoolean(Constants.KEY_IS_SUBSCRIPTION_ACTIVE, false)

        userName = intent.getStringExtra(Constants.USER_NAME)
            ?: prefs.getString(Constants.USER_NAME, "Developer")
            ?: "Developer"

        coinsBalance = prefs.getInt(Constants.KEY_COINS, 250)

        setupBillingManager()
        initializeViews()
        setupTopBar()
        setupBottomNav()
        setupTasksScreen()
        setupBoostStore()
        setupBuyCodesScreen()
        setupMoreScreen()

        // setupTopBar() runs before the More screen exists, so re-publish the
        // balance now that its views are bound.
        updateCoinsDisplay()

        // The Tasks screen now carries a section of the user's own orders, so it needs them
        // on first open rather than after a trip to More. `loadMoreData` is guarded, so this
        // is one fetch for the whole session.
        loadMoreData()

        val targetTab = intent.getStringExtra(Constants.SELECTED_TAB)
        when (targetTab) {
            "BUY_CODES" -> selectTab(2)
            "BOOST" -> selectTab(1)
            else -> selectTab(0)
        }
    }

    override fun onResume() {
        super.onResume()
        handleTaskReturnOnResume()
    }

    // ------------------------------------------------------------------
    // Billing wiring
    // ------------------------------------------------------------------

    private fun setupBillingManager() {
        billingManager = BillingManager(
            activity = this,
            onPurchaseSuccess = { productId, purchaseToken, orderId ->
                handleSuccessfulPurchase(productId, purchaseToken, orderId)
            },
            onPurchaseFailed = { errorMessage ->
                setBillingStatus(errorMessage, isError = true)
                Toast.makeText(this, errorMessage, Toast.LENGTH_LONG).show()
                withdrawUnpaidPlayOrder()
            },
            onPurchasePending = { _ ->
                setBillingStatus(
                    "Payment is pending Google Play confirmation. Access unlocks automatically once it completes.",
                    isError = false
                )
                Toast.makeText(
                    this,
                    "Payment pending - access unlocks once Google Play confirms it.",
                    Toast.LENGTH_LONG
                ).show()
            },
            onProductUnavailable = { _, reason ->
                setBillingStatus(reason, isError = true)
                showBillingProblemDialog(reason)
                withdrawUnpaidPlayOrder()
            },
            onCatalogStateChanged = { isReady, status ->
                setBillingStatus(status, isError = !isReady)
                syncSubscriptionPricing()
                syncActiveDialog()
                if (::buyCodesAdapter.isInitialized) {
                    buyCodesAdapter.refreshPrices()
                }
                if (isReady && !hasRestoredOwnedPurchases) {
                    hasRestoredOwnedPurchases = true
                    refreshOwnedPurchases()
                }
            }
        )
    }

    private fun handleSuccessfulPurchase(productId: String, purchaseToken: String, orderId: String) {
        // Check if this is a boost product (followers/likes/coins)
        if (Constants.isBoostProduct(productId)) {
            handleBoostPurchaseSuccess(productId, purchaseToken, orderId)
            return
        }

        val targetItem = allCodesList.firstOrNull { it.productId == productId || it.id == productId }
            ?: activeItem

        if (targetItem == null) {
            Log.w("HomeActivity", "Purchase completed for unknown product $productId")
            return
        }

        val isSubscription = Constants.isSubscription(productId)

        if (isSubscription) {
            isSubscriptionActive = true
            prefs.edit().putBoolean(Constants.KEY_IS_SUBSCRIPTION_ACTIVE, true).apply()
            updateSubscriptionBannerState()
            if (::buyCodesAdapter.isInitialized) {
                buyCodesAdapter.notifyDataSetChanged()
            }
        } else {
            markCodesPurchased(listOf(targetItem.id))
        }

        coinsBalance += 100
        updateCoinsDisplay()

        notifyBackendPurchase(targetItem.id, productId, purchaseToken, orderId)

        activeCheckoutForm?.visibility = View.GONE
        activeUnlockedLayout?.visibility = View.VISIBLE
        activeTitleHeader?.text = if (isSubscription) "All-Access Pass Activated! 👑" else "Source Code Unlocked!"

        Toast.makeText(this, "Purchase confirmed. Order: $orderId", Toast.LENGTH_LONG).show()
    }

    /**
     * Handle a successful Google Play purchase for a boost product.
     * Notifies the backend to verify the receipt and activate the pending order.
     */
    private fun handleBoostPurchaseSuccess(productId: String, purchaseToken: String, googleOrderId: String) {
        if (productId == "tt_coin_19_99") {
            coinsBalance += 1000
            updateCoinsDisplay()
            Toast.makeText(this, "1,000 Coins added to your balance! 🪙", Toast.LENGTH_LONG).show()
            return
        }
        if (productId == "tt_coin_99_99") {
            coinsBalance += 10000
            updateCoinsDisplay()
            Toast.makeText(this, "10,000 Coins added to your balance! 🪙", Toast.LENGTH_LONG).show()
            return
        }

        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null)
        if (token.isNullOrBlank()) {
            Toast.makeText(this, "Sign in required to complete purchase", Toast.LENGTH_LONG).show()
            return
        }

        val orderId = pendingPlayOrderId
        if (orderId == 0) {
            Toast.makeText(this, "No pending order found. Please try again.", Toast.LENGTH_LONG).show()
            return
        }

        Toast.makeText(this, "Verifying purchase…", Toast.LENGTH_SHORT).show()

        Thread {
            try {
                val result = SocialBoostApi.notifyPayment(token, orderId, purchaseToken, googleOrderId)
                val success = result.optBoolean("success", false)

                runOnUiThread {
                    pendingPlayOrderId = 0
                    if (success) {
                        Toast.makeText(this, "Purchase verified and order activated!", Toast.LENGTH_LONG).show()
                        loadMoreData(force = true)
                    } else {
                        val errorCode = result.optString("error_code", "Unknown")
                        Toast.makeText(this, "Verification failed: $errorCode", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                Log.w("HomeActivity", "payment notify failed: ${e.message}")
                runOnUiThread {
                    pendingPlayOrderId = 0
                    Toast.makeText(this, "Could not verify purchase: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }.start()
    }

    /** Persist ownership and refresh the list + any open dialog. */
    private fun markCodesPurchased(codeIds: Collection<String>) {
        if (codeIds.isEmpty()) return

        val stored = prefs.getStringSet(Constants.KEY_PURCHASED_IDS, emptySet()) ?: emptySet()
        val updated = HashSet(stored).apply { addAll(codeIds) }
        prefs.edit().putStringSet(Constants.KEY_PURCHASED_IDS, updated).apply()

        allCodesList.forEachIndexed { index, item ->
            if (updated.contains(item.id) && !item.isPurchased) {
                item.isPurchased = true
                if (::buyCodesAdapter.isInitialized) {
                    buyCodesAdapter.notifyItemChanged(index)
                }
            }
        }

        activeItem?.let { active ->
            if (active.isPurchased) {
                activeCheckoutForm?.visibility = View.GONE
                activeUnlockedLayout?.visibility = View.VISIBLE
                activeTitleHeader?.text = "Unlocked Code & Repository"
            }
        }
    }

    /**
     * Re-apply the locally stored ownership flags to the current list.
     *
     * Ownership is the UNION of two independent sources: Google Play one-time
     * purchases, and coins spent in the Store. They live under separate keys
     * because a Play restore rewrites its own set wholesale — sharing one key
     * would let a restore silently wipe every coin unlock.
     */
    private fun applyPurchasedState() {
        val playOwned = prefs.getStringSet(Constants.KEY_PURCHASED_IDS, emptySet()) ?: emptySet()
        val coinOwned = prefs.getStringSet(Constants.KEY_COIN_UNLOCKED_IDS, emptySet()) ?: emptySet()

        allCodesList.forEach { code ->
            code.isPurchased = playOwned.contains(code.id) || coinOwned.contains(code.id)
        }
        if (::buyCodesAdapter.isInitialized) {
            buyCodesAdapter.notifyDataSetChanged()
        }
    }

    /**
     * Ask Google Play what this account already owns and unlock it locally.
     * This is what makes paid codes survive a reinstall or a device change.
     */
    private fun refreshOwnedPurchases(notifyUser: Boolean = false) {
        billingManager.restorePurchases { ownedProductIds ->
            val ownedCodeIds = ownedProductIds.mapNotNull { Constants.codeIdForProductId(it) }.toSet()

            // Authoritative sync: save ONLY genuine INAPP purchases returned by Google Play
            prefs.edit().putStringSet(Constants.KEY_PURCHASED_IDS, ownedCodeIds).apply()
            applyPurchasedState()

            billingManager.checkExistingSubscription { isActive ->
                isSubscriptionActive = isActive
                prefs.edit().putBoolean(Constants.KEY_IS_SUBSCRIPTION_ACTIVE, isActive).apply()
                updateSubscriptionBannerState()
                if (::buyCodesAdapter.isInitialized) {
                    buyCodesAdapter.notifyDataSetChanged()
                }

                if (notifyUser) {
                    val message = when {
                        ownedCodeIds.isNotEmpty() && isActive ->
                            "Restored ${ownedCodeIds.size} purchased code(s) + Active All-Access Pass!"
                        ownedCodeIds.isNotEmpty() ->
                            "Restored ${ownedCodeIds.size} purchased code(s)"
                        isActive ->
                            "All-Access Pass active - every code unlocked!"
                        else ->
                            "No previous purchases found on this Google account"
                    }
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun notifyBackendPurchase(codeId: String, productId: String, purchaseToken: String, orderId: String) {
        // Optional server-side verification. Leave Constants.PAYMENT_BACKEND_URL blank to
        // run 100% on-device through Google Play Billing.
        if (Constants.PAYMENT_BACKEND_URL.isBlank()) {
            Log.d("BackendVerification", "No backend configured - Google Play is the source of truth")
            return
        }

        Thread {
            try {
                val isSub = Constants.isSubscription(productId)
                val path = if (isSub) "/api/subscription/notify" else "/api/payment/notify"
                val serverUrl = Constants.PAYMENT_BACKEND_URL.trimEnd('/') + path

                val url = URL(serverUrl)
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.connectTimeout = 4000
                conn.readTimeout = 4000
                conn.doOutput = true

                val jsonBody = JSONObject().apply {
                    put("user_id", 1)
                    put("code_id", codeId)
                    put("product_id", productId)
                    put("subscription_id", productId)
                    put("purchase_token", purchaseToken)
                    put("order_id", orderId)
                    put("google_order_id", orderId)
                }

                conn.outputStream.use { os ->
                    os.write(jsonBody.toString().toByteArray(Charsets.UTF_8))
                }

                Log.d("BackendVerification", "Backend responded ${conn.responseCode} from $serverUrl")
            } catch (e: Exception) {
                Log.w("BackendVerification", "Backend unreachable, Google Play purchase is still valid: ${e.message}")
            }
        }.start()
    }

    private var tvBoostCoinsBadge: TextView? = null

    private fun initializeViews() {
        tvGreeting = findViewById(R.id.tv_home_greeting)
        tvCoins = findViewById(R.id.tv_coins_balance)
        viewFlipper = findViewById(R.id.view_flipper_screens)

        ivNavHome = findViewById(R.id.iv_nav_home)
        tvNavHome = findViewById(R.id.tv_nav_home)
        ivNavBoost = findViewById(R.id.iv_nav_boost)
        tvNavBoost = findViewById(R.id.tv_nav_boost)
        ivNavCodes = findViewById(R.id.iv_nav_codes)
        tvNavCodes = findViewById(R.id.tv_nav_codes)
        ivNavMore = findViewById(R.id.iv_nav_more)
        tvNavMore = findViewById(R.id.tv_nav_more)

        rvBuyCodes = findViewById(R.id.rv_buy_codes)
        rvBoostProducts = findViewById(R.id.rv_boost_products)
        progressBoost = findViewById(R.id.progress_boost)
        tvBoostEmpty = findViewById(R.id.tv_boost_empty)

        chipFilterAll = findViewById(R.id.chip_filter_all)
        chipFilterFullstack = findViewById(R.id.chip_filter_fullstack)
        chipFilterMobile = findViewById(R.id.chip_filter_mobile)
        chipFilterFrontend = findViewById(R.id.chip_filter_frontend)
        chipFilterBackend = findViewById(R.id.chip_filter_backend)

        layoutTopWordmark = findViewById(R.id.layout_top_wordmark)
        tvTopScreenTitle = findViewById(R.id.tv_top_screen_title)
    }

    private fun setupTopBar() {
        tvGreeting.text = "Hello, $userName 👋"
        updateCoinsDisplay()
        loadProfileAvatar()

        // The cached balance is only a placeholder until the server answers.
        refreshCoinsFromServer(silent = true)

        findViewById<View>(R.id.chip_coins).setOnClickListener {
            refreshCoinsFromServer(silent = false)
        }
    }

    /**
     * Paint the signed-in user's TikTok avatar into both avatar rings.
     *
     * Two problems made this show the wrong picture (or none):
     *
     * - the URL was captured **once at login** and never refreshed, so a placeholder
     *   captured during a stub-backed login stayed forever even after the server had the
     *   real avatar; and
     * - the captured URL was the raw TikTok CDN one, which is time-signed and starts
     *   403ing after ~2 days, leaving an empty ring.
     *
     * So: render what we have immediately (mirror URL first), then ask the server what it
     * holds and re-render if the handle/URL changed.
     */
    private fun loadProfileAvatar() {
        val handle = prefs.getString(Constants.KEY_TIKTOK_USERNAME, null)
        val cached = prefs.getString(Constants.KEY_AVATAR_URL, null)

        paintAvatar(handle, cached)
        refreshProfileFromServer()
    }

    /** Render one account's picture into both rings, falling back down the URL list. */
    private fun paintAvatar(handle: String?, avatarUrl: String?) {
        val urls = Avatars.candidates(handle, avatarUrl)
        listOf(R.id.iv_top_avatar, R.id.iv_more_avatar).forEach { id ->
            findViewById<ImageView>(id)?.let { Avatars.load(it, urls, handle) }
        }
    }

    /**
     * Ask `/v6/me` for the stored TikTok profile and repaint if it disagrees with what we
     * cached. Silent by design: a failure here must not disturb the screen, because the
     * cached avatar is already on display.
     */
    private fun refreshProfileFromServer() {
        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null) ?: return
        val handle = prefs.getString(Constants.KEY_TIKTOK_USERNAME, null)
        val secUid = prefs.getString(Constants.KEY_SEC_UID, null)

        Thread {
            try {
                val profile = SocialBoostApi.fetchProfile(token, handle, secUid)

                if (profile == null) {
                    // Deployed builds predate `tiktok_info` on /v6/me, so there is no
                    // profile block to read. The order rows still carry the account's
                    // picture snapshot, so use the newest real one instead of showing
                    // nothing at all. Harmless once the server is updated.
                    val fallback = try {
                        SocialBoostApi.fetchMyOrders(token)
                            .mapNotNull { it.image }
                            .firstOrNull { it.isNotBlank() && !it.contains("picsum") }
                    } catch (_: Exception) {
                        null
                    }
                    if (!fallback.isNullOrBlank()) {
                        runOnUiThread { paintAvatar(handle, fallback) }
                    }
                    return@Thread
                }

                val resolvedHandle = profile.username ?: handle
                // Prefer the server's mirror path; keep the CDN URL only as a fallback.
                val best = profile.avatarUrl
                    ?: profile.avatarLarger
                    ?: prefs.getString(Constants.KEY_AVATAR_URL, null)

                val changed = resolvedHandle != handle || best != prefs.getString(Constants.KEY_AVATAR_URL, null)
                if (!changed) return@Thread

                prefs.edit()
                    .putString(Constants.KEY_TIKTOK_USERNAME, resolvedHandle)
                    .putString(Constants.KEY_AVATAR_URL, best)
                    .putString(Constants.USER_NAME, profile.nickname ?: resolvedHandle)
                    .apply()

                runOnUiThread {
                    paintAvatar(resolvedHandle, best)
                    profile.nickname?.let { tvGreeting.text = "Hello, $it 👋" }
                }
            } catch (e: Exception) {
                // Old server builds return no `tiktok_info` at all; the cached avatar stays.
                Log.d("HomeActivity", "profile refresh skipped: ${e.message}")
            }
        }.start()
    }

    private fun updateCoinsDisplay() {
        tvCoins.text = "$coinsBalance"
        prefs.edit().putInt(Constants.KEY_COINS, coinsBalance).apply()

        // Keep the Store's affordability flags in step with the balance.
        if (::boostAdapter.isInitialized) boostAdapter.refreshAffordability()
        if (::tvMoreCoins.isInitialized) tvMoreCoins.text = "$coinsBalance coins"
        tvBoostCoinsBadge?.text = "$coinsBalance coins available"
    }

    private fun setupBottomNav() {
        findViewById<View>(R.id.nav_home).setOnClickListener { selectTab(0) }
        findViewById<View>(R.id.nav_boost).setOnClickListener { selectTab(1) }
        findViewById<View>(R.id.nav_codes).setOnClickListener { selectTab(2) }
        findViewById<View>(R.id.nav_more).setOnClickListener { selectTab(3) }
    }

    /** Highlight the active bottom-nav item and flip to its screen. */
    private fun selectTab(index: Int) {
        val activeColor = ContextCompat.getColor(this, R.color.tt_pink)
        val idleColor = ContextCompat.getColor(this, R.color.tt_text_secondary)

        val homeActive = index == 0
        ivNavHome.setColorFilter(if (homeActive) activeColor else idleColor)
        tvNavHome.setTextColor(if (homeActive) activeColor else idleColor)
        tvNavHome.setTypeface(null, if (homeActive) Typeface.BOLD else Typeface.NORMAL)

        val boostActive = index == 1
        ivNavBoost.setColorFilter(if (boostActive) activeColor else idleColor)
        tvNavBoost.setTextColor(if (boostActive) activeColor else idleColor)
        tvNavBoost.setTypeface(null, if (boostActive) Typeface.BOLD else Typeface.NORMAL)

        val codesActive = index == 2
        ivNavCodes.setColorFilter(if (codesActive) activeColor else idleColor)
        tvNavCodes.setTextColor(if (codesActive) activeColor else idleColor)
        tvNavCodes.setTypeface(null, if (codesActive) Typeface.BOLD else Typeface.NORMAL)

        val moreActive = index == 3
        ivNavMore.setColorFilter(if (moreActive) activeColor else idleColor)
        tvNavMore.setTextColor(if (moreActive) activeColor else idleColor)
        tvNavMore.setTypeface(null, if (moreActive) Typeface.BOLD else Typeface.NORMAL)

        viewFlipper.displayedChild = index

        if (index == 1) {
            layoutTopWordmark?.visibility = View.GONE
            tvTopScreenTitle?.visibility = View.VISIBLE
            tvTopScreenTitle?.text = "Store"
        } else {
            layoutTopWordmark?.visibility = View.VISIBLE
            tvTopScreenTitle?.visibility = View.GONE
        }

        // Returning Home with an exhausted queue should pull a fresh page.
        if (index == 0 && taskQueue.isEmpty() && currentTask == null) loadTasks()
        if (index == 1) {
            updateBoostTargetAccountInfo()
            loadBoostProducts()
        }
        if (index == 2) {
            loadCodePrices()
            applyPurchasedState()
        }
        if (index == 3) {
            loadMoreData()
            // Re-read the claim state: "claimed today" is a server fact about a day that
            // may have ticked over since the screen was last open.
            refreshDailyReward()
        } else {
            stopDailyCountdown()
        }
    }

    // ------------------------------------------------------------------
    // Tasks screen (SocialBoost Home)
    // ------------------------------------------------------------------

    private lateinit var tvTaskUsername: TextView
    private lateinit var ivTaskAvatar: ImageView
    private lateinit var btnTaskSkip: TextView
    private lateinit var btnTaskFollow: LinearLayout
    private lateinit var tvTaskFollowLabel: TextView
    private lateinit var tvTaskReward: TextView
    private lateinit var layoutTaskEmpty: LinearLayout
    private lateinit var tvTaskEmpty: TextView
    private lateinit var progressTaskLoading: android.widget.ProgressBar
    private lateinit var scrollTask: android.widget.ScrollView
    private lateinit var layoutTipsBody: LinearLayout
    private lateinit var btnTipsToggle: ImageView
    private lateinit var swipeTasks: androidx.swiperefreshlayout.widget.SwipeRefreshLayout

    /** The queue of tasks returned by the feed, and the one currently on screen. */
    private val taskQueue = ArrayDeque<SocialBoostApi.TaskItem>()
    private var currentTask: SocialBoostApi.TaskItem? = null
    private var isVerifying = false
    private var pendingVerificationTask: SocialBoostApi.TaskItem? = null
    private var taskOpenedTimestamp: Long = 0L
    private var hasActionBeenOpened = false

    /**
     * Set once we have drained a fetched page and asked the server for more.
     * Stops "queue empty -> refetch -> still empty" from looping forever, while
     * still giving the user a second page instead of a premature "No tasks".
     */
    private var drainedPageRefetched = false

    /**
     * Which page of the feed to request next.
     *
     * The feed is filtered per viewer — a task leaves it as soon as the viewer skips
     * it — so the only way to keep seeing tasks is to walk the pages rather than
     * re-asking for page 1. This used to be hardcoded to 1 on every request, which
     * is why the queue died after ~10 tasks and never came back until the skips were
     * cleared. Reset to 1 by a pull-to-refresh.
     */
    private var nextPage = 1

    private fun setupTasksScreen() {
        tvTaskUsername = findViewById(R.id.tv_task_username)
        ivTaskAvatar = findViewById(R.id.iv_task_avatar)
        btnTaskSkip = findViewById(R.id.btn_task_skip)
        btnTaskFollow = findViewById(R.id.btn_task_follow)
        tvTaskFollowLabel = findViewById(R.id.tv_task_follow_label)
        tvTaskReward = findViewById(R.id.tv_task_reward)
        layoutTaskEmpty = findViewById(R.id.layout_task_empty)
        tvTaskEmpty = findViewById(R.id.tv_task_empty)
        progressTaskLoading = findViewById(R.id.progress_task_loading)
        scrollTask = findViewById(R.id.scroll_task)
        layoutTipsBody = findViewById(R.id.layout_tips_body)
        btnTipsToggle = findViewById(R.id.btn_tips_toggle)
        swipeTasks = findViewById(R.id.swipe_tasks)

        // "Pull to retry" has to actually retry. The empty state used to tell the
        // user to pull while nothing listened for the gesture, so a failed or
        // exhausted feed was a dead end until the app was restarted.
        swipeTasks.setColorSchemeColors(getColor(R.color.tt_pink), getColor(R.color.tt_blue))
        swipeTasks.setProgressBackgroundColorSchemeColor(getColor(R.color.tt_surface_elevated))
        // A pull-to-refresh means "start over from the top of the feed".
        swipeTasks.setOnRefreshListener {
            nextPage = 1
            drainedPageRefetched = false
            loadTasks(pageToLoad = 1)
        }
        // Tapping the empty state is the discoverable equivalent of the swipe.
        layoutTaskEmpty.setOnClickListener {
            nextPage = 1
            drainedPageRefetched = false
            loadTasks(pageToLoad = 1)
        }

        // Collapse / expand the Tips card.
        btnTipsToggle.setOnClickListener {
            val show = layoutTipsBody.visibility != View.VISIBLE
            layoutTipsBody.visibility = if (show) View.VISIBLE else View.GONE
            btnTipsToggle.rotation = if (show) 0f else 180f
        }

        btnTaskSkip.setOnClickListener { skipCurrentTask() }
        btnTaskFollow.setOnClickListener { completeCurrentTask() }

        // The initial fetch is driven by selectTab(0) at the end of onCreate, so
        // there is exactly one load path and the feed is never fetched twice.
        showTaskState(loading = true)
    }

    // ------------------------------------------------------------------
    // More screen: profile, order history, coins ledger
    // ------------------------------------------------------------------

    private fun setupMoreScreen() {
        tvMoreUsername = findViewById(R.id.tv_more_username)
        tvMoreCoins = findViewById(R.id.tv_more_coins)
        progressOrders = findViewById(R.id.progress_orders)
        tvOrdersEmpty = findViewById(R.id.tv_orders_empty)
        progressCoinHistory = findViewById(R.id.progress_coin_history)
        tvCoinHistoryEmpty = findViewById(R.id.tv_coin_history_empty)

        orderHistoryAdapter = OrderHistoryAdapter(orderHistory)
        rvMyOrders = findViewById(R.id.rv_my_orders)
        rvMyOrders.layoutManager = LinearLayoutManager(this)
        rvMyOrders.adapter = orderHistoryAdapter

        coinHistoryAdapter = CoinHistoryAdapter(coinHistory)
        rvCoinHistory = findViewById(R.id.rv_coin_history)
        rvCoinHistory.layoutManager = LinearLayoutManager(this)
        rvCoinHistory.adapter = coinHistoryAdapter

        // The same orders, also shown on the Tasks screen beneath the live task card.
        // Its own list rather than sharing `orderHistory`: two adapters mutating one
        // backing list is how you get a RecyclerView reading a cleared array mid-layout.
        taskOrderAdapter = TaskOrderAdapter(mutableListOf())
        rvTaskOrders = findViewById(R.id.rv_task_orders)
        rvTaskOrders.layoutManager =
            LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)
        rvTaskOrders.adapter = taskOrderAdapter
        sectionTaskOrders = findViewById(R.id.section_task_orders)
        tvTaskOrdersCount = findViewById(R.id.tv_task_orders_count)
        tvTaskOrdersEmpty = findViewById(R.id.tv_task_orders_empty)

        findViewById<View>(R.id.btn_more_refresh).setOnClickListener {
            refreshCoinsFromServer()
            loadMoreData(force = true)
        }
        findViewById<View>(R.id.btn_more_signout).setOnClickListener { confirmSignOut() }
        findViewById<View>(R.id.btn_more_how_it_works).setOnClickListener { showHowItWorksDialog() }

        setupDailyReward()

        val handle = prefs.getString(Constants.KEY_TIKTOK_USERNAME, null)
        tvMoreUsername.text = if (handle.isNullOrBlank()) userName else "@$handle"
    }

    // ------------------------------------------------------------------
    // More screen: the free daily coin claim
    // ------------------------------------------------------------------

    /**
     * Bind the daily-reward card.
     *
     * The claimable state is read from the server every time the screen opens. A locally
     * remembered "already claimed today" would be wrong the moment the day rolls over, and
     * a locally remembered "claimable" would let someone click a button that only fails.
     */
    private fun setupDailyReward() {
        cardDailyReward = findViewById(R.id.card_daily_reward)
        tvDailyRewardSubtitle = findViewById(R.id.tv_daily_reward_subtitle)
        btnDailyClaim = findViewById(R.id.btn_daily_claim)

        btnDailyClaim?.setOnClickListener { claimDailyReward() }
        refreshDailyReward()
    }

    /** Ask the server what the claim looks like right now. */
    private fun refreshDailyReward() {
        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null)
        if (token.isNullOrBlank()) {
            cardDailyReward?.visibility = View.GONE
            return
        }

        Thread {
            val bonus = try {
                SocialBoostApi.fetchDailyBonus(token)
            } catch (e: Exception) {
                Log.d("HomeActivity", "daily bonus unavailable: ${e.message}")
                null
            }

            runOnUiThread {
                if (bonus == null) {
                    // Older server builds have no daily bonus. Hiding the card is better
                    // than a control that only ever fails and looks broken.
                    cardDailyReward?.visibility = View.GONE
                    return@runOnUiThread
                }
                dailyBonusState = bonus
                renderDailyReward()
            }
        }.start()
    }

    private fun renderDailyReward() {
        val bonus = dailyBonusState ?: return
        cardDailyReward?.visibility = View.VISIBLE

        val base = getString(R.string.tt_daily_available, bonus.amount)
        if (bonus.available) {
            btnDailyClaim?.isEnabled = true
            btnDailyClaim?.text = getString(R.string.tt_daily_claim)
            tvDailyRewardSubtitle?.text =
                if (bonus.streak >= 2) "$base · ${getString(R.string.tt_daily_streak, bonus.streak)}" else base
            stopDailyCountdown()
            return
        }

        btnDailyClaim?.isEnabled = false
        btnDailyClaim?.text = getString(R.string.tt_daily_claimed)
        startDailyCountdown()
    }

    /** One-second ticker toward `nextClaimAt`, refreshed from the server, not the clock. */
    private fun startDailyCountdown() {
        val next = dailyBonusState?.nextClaimAt ?: return
        dailyHandler.removeCallbacks(dailyRunnable)

        dailyRunnable = object : Runnable {
            override fun run() {
                val bonus = dailyBonusState ?: return
                val remaining = bonus.nextClaimAt ?: return

                val left = remaining - System.currentTimeMillis()
                if (left <= 0) {
                    refreshDailyReward()
                    return
                }

                val hours = left / 3_600_000
                val minutes = (left % 3_600_000) / 60_000
                val seconds = (left % 60_000) / 1_000
                val clock = String.format("%02d:%02d:%02d", hours, minutes, seconds)

                tvDailyRewardSubtitle?.text = getString(R.string.tt_daily_countdown, clock)
                dailyHandler.postDelayed(this, 1_000)
            }
        }
        dailyHandler.post(dailyRunnable)
    }

    private fun stopDailyCountdown() {
        dailyHandler.removeCallbacks(dailyRunnable)
    }

    private fun claimDailyReward() {
        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null) ?: return
        btnDailyClaim?.isEnabled = false
        btnDailyClaim?.text = getString(R.string.tt_daily_claiming)

        Thread {
            try {
                val result = SocialBoostApi.claimDailyBonus(token)
                val granted = result.optJSONObject("daily_bonus")?.optInt("granted", 0) ?: 0
                val freshCoins = result.optJSONObject("user")?.optInt("coins", coinsBalance) ?: coinsBalance

                runOnUiThread {
                    coinsBalance = freshCoins
                    updateCoinsDisplay()
                    Toast.makeText(this, getString(R.string.tt_daily_done, granted), Toast.LENGTH_LONG).show()
                }
            } catch (e: Exception) {
                val why = e.message ?: ""
                runOnUiThread {
                    Toast.makeText(this, getString(R.string.tt_daily_failed, why), Toast.LENGTH_LONG).show()
                }
            } finally {
                runOnUiThread { refreshDailyReward() }
            }
        }.start()
    }

    // ------------------------------------------------------------------
    // More screen: how it works
    // ------------------------------------------------------------------

    /**
     * The app has two sides that feed each other — a buyer's order becomes a worker's
     * task — and neither side could see it. This spells it out once.
     */
    private fun showHowItWorksDialog() {
        val view = LayoutInflater.from(this).inflate(R.layout.dialog_how_it_works, null)
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
            .setView(view)
            .setCancelable(true)
            .create()

        view.findViewById<View>(R.id.btn_how_back).setOnClickListener { dialog.dismiss() }

        bindHowStep(view, R.id.how_step_buy_1, 1, getString(R.string.tt_how_buy_1))
        bindHowStep(view, R.id.how_step_buy_2, 2, getString(R.string.tt_how_buy_2))
        bindHowStep(view, R.id.how_step_buy_3, 3, getString(R.string.tt_how_buy_3))
        bindHowStep(view, R.id.how_step_buy_4, 4, getString(R.string.tt_how_buy_4))

        bindHowStep(view, R.id.how_step_earn_1, 1, getString(R.string.tt_how_earn_1))
        bindHowStep(view, R.id.how_step_earn_2, 2, getString(R.string.tt_how_earn_2))
        bindHowStep(view, R.id.how_step_earn_3, 3, getString(R.string.tt_how_earn_3))
        bindHowStep(view, R.id.how_step_earn_4, 4, getString(R.string.tt_how_earn_4))

        dialog.show()
    }

    private fun bindHowStep(root: View, includeId: Int, number: Int, text: String) {
        val row = root.findViewById<View>(includeId) ?: return
        row.findViewById<TextView>(R.id.tv_step_number)?.text = number.toString()
        row.findViewById<TextView>(R.id.tv_step_text)?.text = text
    }

    /**
     * What happens after a successful order.
     *
     * A toast saying "Ordered 100 followers" tells the buyer nothing about what their money
     * bought — and the app's whole mechanic (my order becomes someone else's task) is the
     * part that makes them trust it. So the confirmation says where the order goes, who
     * acts on it, and how to follow its progress, with a route into the fuller explanation.
     */
    private fun showOrderPlacedDialog(countLabel: String, typeLabel: String, handle: String, isLikes: Boolean) {
        val what = if (isLikes) "video" else "profile"
        val action = if (isLikes) "like" else "follow"

        AlertDialog.Builder(this)
            .setTitle(getString(R.string.tt_order_placed_title))
            .setMessage(
                getString(
                    R.string.tt_order_placed_body,
                    countLabel,
                    typeLabel,
                    handle,
                    what,
                    action
                )
            )
            .setPositiveButton(getString(R.string.tt_done), null)
            .setNeutralButton(getString(R.string.tt_how_it_works)) { _, _ -> showHowItWorksDialog() }
            .show()
    }

    /**
     * Load the order and coins history.
     *
     * Lazy on the first open so a user who never visits More pays nothing for it,
     * then cached — the refresh button forces a reload.
     */
    private fun loadMoreData(force: Boolean = false) {
        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null)
        if (token.isNullOrBlank()) return
        if (hasLoadedMore && !force) return
        hasLoadedMore = true

        progressOrders.visibility = View.VISIBLE
        progressCoinHistory.visibility = View.VISIBLE

        Thread {
            val orders = try {
                SocialBoostApi.fetchMyOrders(token)
            } catch (e: Exception) {
                Log.w("HomeActivity", "order history failed: ${e.message}")
                emptyList()
            }

            val ledger = try {
                SocialBoostApi.fetchCoinHistory(token)
            } catch (e: Exception) {
                Log.w("HomeActivity", "coin history failed: ${e.message}")
                emptyList()
            }

            runOnUiThread {
                progressOrders.visibility = View.GONE
                progressCoinHistory.visibility = View.GONE

                orderHistoryAdapter.submit(orders)
                rvMyOrders.visibility = if (orders.isEmpty()) View.GONE else View.VISIBLE
                tvOrdersEmpty.visibility = if (orders.isEmpty()) View.VISIBLE else View.GONE

                // Same rows, second home. The Tasks screen shows the buyer's own orders
                // next to the task they are being asked to do, so the two sides of the app
                // are visible together instead of on two different tabs.
                taskOrderAdapter.submit(orders)
                tvTaskOrdersCount.text = orders.size.toString()
                rvTaskOrders.visibility = if (orders.isEmpty()) View.GONE else View.VISIBLE
                tvTaskOrdersEmpty.visibility = if (orders.isEmpty()) View.VISIBLE else View.GONE
                sectionTaskOrders?.visibility = View.VISIBLE

                coinHistoryAdapter.submit(ledger)
                rvCoinHistory.visibility = if (ledger.isEmpty()) View.GONE else View.VISIBLE
                tvCoinHistoryEmpty.visibility = if (ledger.isEmpty()) View.VISIBLE else View.GONE
            }
        }.start()
    }

    private fun confirmSignOut() {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.tt_more_signout))
            .setMessage("Sign out of SocialBoost? Your coins and unlocks stay on your account.")
            .setNegativeButton(getString(R.string.tt_code_unlock_cancel), null)
            .setPositiveButton(getString(R.string.tt_more_signout)) { _, _ -> signOut() }
            .show()
    }

    /** Pull the authoritative balance from the server. */
    private fun refreshCoinsFromServer(silent: Boolean = false) {
        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null) ?: return
        if (!silent) Toast.makeText(this, "Refreshing…", Toast.LENGTH_SHORT).show()

        Thread {
            try {
                val coins = SocialBoostApi.fetchCoins(token)
                runOnUiThread {
                    coinsBalance = coins
                    updateCoinsDisplay()
                    if (!silent) {
                        Toast.makeText(this, "Balance: $coins coins", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                Log.w("HomeActivity", "balance refresh failed: ${e.message}")
                if (!silent) {
                    runOnUiThread {
                        Toast.makeText(this, "Could not refresh balance", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }.start()
    }

    // ------------------------------------------------------------------
    // Store: TikTok boost packages (paid with coins or Google Play)
    // ------------------------------------------------------------------

    data class TikTokVideoSample(
        val id: String,
        val title: String,
        val thumbUrl: String,
        val likes: String,
        val comments: String,
        /**
         * The video's own URL. A likes order is anchored to ONE video — the server reads
         * that video's like count and stores it as the starting point — so this is what
         * actually has to be sent. It used to be dropped entirely, and the order went out
         * with the *profile* URL plus a made-up `post_pk`, which the server could not read.
         */
        val url: String
    )

    private var selectedVideoPostPk: String? = null
    private var selectedVideoTitleStr: String? = null
    private var selectedVideoUrl: String? = null

    private fun updateBoostTargetAccountInfo() {
        tvBoostCoinsBadge?.text = "$coinsBalance coins available"
    }

    private fun setupBoostStore() {
        boostAdapter = BoostAdapter(
            allProducts = boostProducts,
            coinBalance = { coinsBalance },
            onProductSelected = { product -> buyBoostProduct(product) }
        )

        rvBoostProducts.layoutManager = LinearLayoutManager(this)
        rvBoostProducts.isNestedScrollingEnabled = false
        rvBoostProducts.adapter = boostAdapter

        updateBoostTargetAccountInfo()

        val tabProfile = findViewById<View>(R.id.tab_boost_profile)
        val tvTabProfile = findViewById<TextView>(R.id.tv_tab_profile)
        val indicatorProfile = findViewById<View>(R.id.indicator_tab_profile)

        val tabVideo = findViewById<View>(R.id.tab_boost_video)
        val tvTabVideo = findViewById<TextView>(R.id.tv_tab_video)
        val indicatorVideo = findViewById<View>(R.id.indicator_tab_video)

        val cardVideoSelection = findViewById<View>(R.id.card_video_target_selection)

        tabProfile?.setOnClickListener {
            tvTabProfile?.setTextColor(ContextCompat.getColor(this, R.color.white))
            tvTabProfile?.setTypeface(null, Typeface.BOLD)
            indicatorProfile?.visibility = View.VISIBLE

            tvTabVideo?.setTextColor(ContextCompat.getColor(this, R.color.tt_text_secondary))
            tvTabVideo?.setTypeface(null, Typeface.NORMAL)
            indicatorVideo?.visibility = View.INVISIBLE

            cardVideoSelection?.visibility = View.GONE
            boostAdapter.setTab(BoostAdapter.BoostTab.PROFILE)
        }

        tabVideo?.setOnClickListener {
            tvTabVideo?.setTextColor(ContextCompat.getColor(this, R.color.white))
            tvTabVideo?.setTypeface(null, Typeface.BOLD)
            indicatorVideo?.visibility = View.VISIBLE

            tvTabProfile?.setTextColor(ContextCompat.getColor(this, R.color.tt_text_secondary))
            tvTabProfile?.setTypeface(null, Typeface.NORMAL)
            indicatorProfile?.visibility = View.INVISIBLE

            // This used to be GONE here as well as on the Profile tab, and nothing ever
            // made it visible again — so the video picker had no entry point at all and a
            // likes order could never name a video. It belongs on this tab: likes are
            // bought for one video, followers for a whole profile.
            cardVideoSelection?.visibility = View.VISIBLE
            updateSelectedVideoBanner()
            boostAdapter.setTab(BoostAdapter.BoostTab.VIDEO)
        }

        // Pasting a link is the primary path: a likes order names one video, and the link
        // is what the people doing the task open. The grid is offered from inside the paste
        // screen as a convenience, not as a gate in front of it.
        cardVideoSelection?.setOnClickListener {
            showAddVideoLinkDialog()
        }

        setupCoinPackButtons()
        loadBoostProducts()
    }

    private fun updateSelectedVideoBanner() {
        val tvTitle = findViewById<TextView>(R.id.tv_selected_video_title) ?: return
        val tvSubtitle = findViewById<TextView>(R.id.tv_selected_video_subtitle) ?: return
        if (!selectedVideoTitleStr.isNullOrBlank()) {
            tvTitle.text = selectedVideoTitleStr
            tvSubtitle.text = "Target video selected for TikTok Likes"
        } else {
            tvTitle.text = "Paste your video link ❤️"
            tvSubtitle.text = "Tap to paste the TikTok video you want liked"
        }
    }

    /**
     * The video picker.
     *
     * This used to be eight hardcoded unsplash thumbnails with ids like `video_1`, so
     * "selecting a video" only ever produced a fake id — there was no video URL to send,
     * and a likes order is anchored to a specific video. It now loads the account's real
     * posts from /v6/posts and keeps each video's URL; the Add Video tile stays first and
     * works even when the provider returns nothing.
     */
    private fun showChooseVideoDialog() {
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_choose_video, null)
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
            .setView(dialogView)
            .setCancelable(true)
            .create()

        val btnBack: View = dialogView.findViewById(R.id.btn_choose_video_back)
        val rvVideos: RecyclerView = dialogView.findViewById(R.id.rv_choose_videos)

        btnBack.setOnClickListener { dialog.dismiss() }

        val videos = mutableListOf<TikTokVideoSample>()

        rvVideos.layoutManager = androidx.recyclerview.widget.GridLayoutManager(this, 3)
        val adapter = object : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
            override fun getItemCount(): Int = videos.size + 1

            override fun getItemViewType(position: Int): Int = if (position == 0) 0 else 1

            override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
                val v = LayoutInflater.from(parent.context).inflate(R.layout.item_video_card, parent, false)
                return object : RecyclerView.ViewHolder(v) {}
            }

            override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
                val layoutNormal = holder.itemView.findViewById<View>(R.id.layout_normal_video)
                val layoutAdd = holder.itemView.findViewById<View>(R.id.layout_add_video)

                if (position == 0) {
                    layoutNormal.visibility = View.GONE
                    layoutAdd.visibility = View.VISIBLE
                    holder.itemView.setOnClickListener {
                        dialog.dismiss()
                        showAddVideoLinkDialog()
                    }
                } else {
                    layoutNormal.visibility = View.VISIBLE
                    layoutAdd.visibility = View.GONE
                    val item = videos[position - 1]
                    val ivThumb = holder.itemView.findViewById<ImageView>(R.id.iv_video_thumb)
                    val tvLikes = holder.itemView.findViewById<TextView>(R.id.tv_video_likes)
                    val tvComments = holder.itemView.findViewById<TextView>(R.id.tv_video_comments)

                    tvLikes.text = item.likes
                    tvComments.text = item.comments
                    if (item.thumbUrl.isNotBlank()) {
                        Glide.with(this@HomeActivity)
                            .load(item.thumbUrl)
                            .placeholder(R.drawable.bg_gradient_dark)
                            .into(ivThumb)
                    } else {
                        ivThumb.setImageResource(R.drawable.bg_gradient_dark)
                    }

                    holder.itemView.setOnClickListener {
                        applySelectedVideo(item.id, item.url, "${item.title} (${item.likes} ❤️)")
                        dialog.dismiss()
                    }
                }
            }
        }
        rvVideos.adapter = adapter

        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null)
        val handle = prefs.getString(Constants.KEY_TIKTOK_USERNAME, null)
        if (!token.isNullOrBlank() && !handle.isNullOrBlank()) {
            Thread {
                val posts = try {
                    SocialBoostApi.fetchPosts(token, handle)
                } catch (e: Exception) {
                    Log.w("HomeActivity", "video list failed: ${e.message}")
                    emptyList()
                }
                runOnUiThread {
                    if (!dialog.isShowing) return@runOnUiThread
                    videos.clear()
                    videos.addAll(
                        posts.map {
                            TikTokVideoSample(it.id, it.title, it.thumbUrl, it.likes, it.comments, it.url)
                        }
                    )
                    adapter.notifyDataSetChanged()
                }
            }.start()
        }

        dialog.show()
    }

    /** Remember the chosen video: its id, its URL, and a label for the banner. */
    private fun applySelectedVideo(postId: String, url: String, label: String) {
        selectedVideoPostPk = postId.ifBlank { null }
        selectedVideoUrl = url
        selectedVideoTitleStr = label
        updateSelectedVideoBanner()
        Toast.makeText(this, getString(R.string.tt_add_video_ok), Toast.LENGTH_SHORT).show()
    }

    /**
     * "Add Video Link" — paste a TikTok video URL.
     *
     * The previous version was a bare dialog that accepted anything at all and stored
     * `url.hashCode()` as the video id. Nothing pasted ever reached the server as a video
     * URL, so the order went out pointing at the profile and the server rejected it with
     * "Could not read that video". This validates the link, keeps the real URL, and
     * explains the failure inline instead of silently accepting garbage.
     */
    private fun showAddVideoLinkDialog() {
        val view = LayoutInflater.from(this).inflate(R.layout.dialog_add_video_link, null)
        val dialog = AlertDialog.Builder(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
            .setView(view)
            .setCancelable(true)
            .create()

        view.findViewById<View>(R.id.btn_add_video_back).setOnClickListener { dialog.dismiss() }

        view.findViewById<View>(R.id.btn_pick_from_videos).setOnClickListener {
            dialog.dismiss()
            showChooseVideoDialog()
        }

        val input = view.findViewById<EditText>(R.id.et_video_url)
        val error = view.findViewById<TextView>(R.id.tv_video_url_error)

        view.findViewById<View>(R.id.btn_add_video_confirm).setOnClickListener {
            val raw = input.text.toString().trim()
            if (raw.isBlank()) {
                error.text = getString(R.string.tt_add_video_empty)
                error.visibility = View.VISIBLE
                return@setOnClickListener
            }

            val parsed = normalizeVideoLink(raw)
            if (parsed == null) {
                error.text = getString(R.string.tt_add_video_bad_link)
                error.visibility = View.VISIBLE
                return@setOnClickListener
            }

            error.visibility = View.GONE
            applySelectedVideo(parsed.first, parsed.second, "Video ${parsed.first.ifBlank { "link" }}")
            dialog.dismiss()
        }

        dialog.show()
    }

    /**
     * Accept `tiktok.com/@handle/video/<id>` (with or without a scheme, www/m, query
     * string) and `vm.tiktok.com` / `vt.tiktok.com` short links.
     *
     * @return (videoId, canonicalUrl) — videoId is blank for a short link, because only the
     *   server can follow the redirect; it extracts the id from the resolved URL itself.
     */
    private fun normalizeVideoLink(raw: String): Pair<String, String>? {
        val withScheme = if (raw.startsWith("http", ignoreCase = true)) raw else "https://$raw"

        Regex("""(?:www\.|m\.)?tiktok\.com/@([A-Za-z0-9._-]+)/video/(\d+)""", RegexOption.IGNORE_CASE)
            .find(withScheme)?.let { match ->
                val handle = match.groupValues[1]
                val id = match.groupValues[2]
                return id to "https://www.tiktok.com/@$handle/video/$id"
            }

        if (Regex("""(?:vm|vt)\.tiktok\.com/\S+""", RegexOption.IGNORE_CASE).containsMatchIn(withScheme)) {
            return "" to withScheme
        }
        return null
    }

    private fun setupCoinPackButtons() {
        // Instant coin pack cards removed to match the authentic SocialBoost Store screenshots
    }

    private fun refreshTokenSilently(onSuccess: (String) -> Unit) {
        val username = prefs.getString(Constants.KEY_TIKTOK_USERNAME, null) ?: "user"
        val loginId = prefs.getString(Constants.KEY_LOGIN_ID, null) ?: "$username@ttboost.app"
        Thread {
            try {
                val data = try {
                    SocialBoostApi.login(loginId, username)
                } catch (e: SocialBoostApi.ApiException) {
                    if (e.errorCode == "UserNotRegistered") {
                        SocialBoostApi.register(loginId, username)
                    } else {
                        throw e
                    }
                }
                val token = data.optJSONObject("auth")?.optString("token").orEmpty()
                if (token.isNotBlank()) {
                    prefs.edit().putString(Constants.KEY_AUTH_TOKEN, token).apply()
                    runOnUiThread { onSuccess(token) }
                }
            } catch (e: Exception) {
                Log.w("HomeActivity", "Silent token refresh failed: ${e.message}")
            }
        }.start()
    }

    private fun loadBoostProducts() {
        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null)
        if (token.isNullOrBlank()) {
            boostAdapter.updateServerProducts(emptyList())
            return
        }

        Thread {
            try {
                val products = SocialBoostApi.fetchProducts(token)
                runOnUiThread {
                    boostAdapter.updateServerProducts(products)
                }
            } catch (e: Exception) {
                Log.w("HomeActivity", "products fetch failed: ${e.message}")
                if (e is SocialBoostApi.ApiException && e.errorCode == "TokenExpired") {
                    refreshTokenSilently { freshToken ->
                        Thread {
                            try {
                                val retry = SocialBoostApi.fetchProducts(freshToken)
                                runOnUiThread { boostAdapter.updateServerProducts(retry) }
                            } catch (_: Exception) {}
                        }.start()
                    }
                }
            }
        }.start()
    }

    /**
     * Buy a boost package — with coins OR with Google Play money.
     */
    private fun buyBoostProduct(product: SocialBoostApi.BoostProduct) {
        val handle = prefs.getString(Constants.KEY_TIKTOK_USERNAME, null) ?: "user"
        val secUid = prefs.getString(Constants.KEY_SEC_UID, null) ?: "MS4wLjABAAAAuyzvb3"
        val typeLabel = product.productType ?: "Followers"
        val countLabel = if (product.actionCount >= 1000) "${product.actionCount / 1000}K" else "${product.actionCount}"

        if (product.isCoinProduct) {
            val coinsNeeded = product.coinsPrice ?: 100
            if (coinsBalance < coinsNeeded) {
                val shortage = coinsNeeded - coinsBalance
                AlertDialog.Builder(this)
                    .setTitle("Need More Coins 🪙")
                    .setMessage("You need $coinsNeeded coins for $countLabel $typeLabel.\nYour current balance is $coinsBalance coins ($shortage more needed).\n\nEarn coins for free on the Tasks tab!")
                    .setPositiveButton("Earn Coins ⚡") { _, _ -> selectTab(0) }
                    .setNegativeButton("Cancel", null)
                    .show()
                return
            }

            AlertDialog.Builder(this)
                .setTitle("Confirm Boost Order ⚡")
                .setMessage("Order $countLabel $typeLabel for @$handle?\n\nPrice: $coinsNeeded coins\nRemaining balance: ${coinsBalance - coinsNeeded} coins")
                .setPositiveButton("Boost Now 🚀") { _, _ ->
                    val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null) ?: ""
                    submitCoinBoostOrder(token, product, secUid, handle, countLabel, typeLabel)
                }
                .setNegativeButton("Cancel", null)
                .show()
        } else {
            val billingId = product.billingProductId ?: "tt_follow_1000"
            AlertDialog.Builder(this)
                .setTitle("Buy $countLabel $typeLabel 💳")
                .setMessage("Pay ${product.price ?: "$2.99"} for $countLabel $typeLabel for @$handle?")
                .setPositiveButton("Continue to Payment") { _, _ ->
                    val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null) ?: ""
                    submitPlayBoostOrder(token, product, billingId, secUid, handle)
                }
                .setNegativeButton("Cancel", null)
                .show()
        }
    }

    private fun submitCoinBoostOrder(
        token: String,
        product: SocialBoostApi.BoostProduct,
        secUid: String,
        handle: String,
        countLabel: String,
        typeLabel: String
    ) {
        Toast.makeText(this, "Placing order…", Toast.LENGTH_SHORT).show()

        val isLikes = typeLabel.contains("Like", ignoreCase = true)

        // A likes order is anchored to ONE video. Sending the profile URL (as this used to)
        // makes the server unable to read a like count, and it rejects the order — which is
        // why buying likes never worked. Ask for the video instead of sending a bad order.
        if (isLikes && selectedVideoUrl.isNullOrBlank()) {
            Toast.makeText(this, getString(R.string.tt_video_required), Toast.LENGTH_LONG).show()
            showChooseVideoDialog()
            return
        }

        val postPk = if (isLikes) selectedVideoPostPk else null
        val targetUrl = if (isLikes) selectedVideoUrl!! else "https://www.tiktok.com/@$handle"

        Thread {
            fun doOrder(authToken: String) {
                try {
                    SocialBoostApi.createOrder(
                        token = authToken,
                        secUid = secUid,
                        username = handle,
                        url = targetUrl,
                        productId = product.id,
                        postPk = postPk
                    )

                    val coins = try {
                        SocialBoostApi.fetchCoins(authToken)
                    } catch (_: Exception) {
                        coinsBalance
                    }

                    runOnUiThread {
                        coinsBalance = coins
                        updateCoinsDisplay()
                        showOrderPlacedDialog(countLabel, typeLabel, handle, isLikes)
                    }
                } catch (e: Exception) {
                    if (e is SocialBoostApi.ApiException && e.errorCode == "TokenExpired") {
                        refreshTokenSilently { fresh -> doOrder(fresh) }
                    } else {
                        // No order was created, so nothing was charged. Re-sync the balance from
                        // the server and report the real failure. This branch used to show a
                        // "delivery is active" success toast after debiting the balance locally,
                        // so a rejected order looked successful and the coins appeared spent.
                        // Same failure class as the mock-purchase fallback removed from
                        // BillingManager; see PURCHASE_FIX_REPORT.md.
                        Log.w("HomeActivity", "order failed: ${e.message}")
                        val coins = try {
                            SocialBoostApi.fetchCoins(authToken)
                        } catch (_: Exception) {
                            coinsBalance
                        }
                        val reason = when ((e as? SocialBoostApi.ApiException)?.errorCode) {
                            "ProductNotFound" -> "that package is no longer available"
                            "CoinsNotEnough" -> "you don't have enough coins"
                            "TokenExpired" -> "your session expired, please sign in again"
                            else -> e.message ?: "please try again"
                        }
                        runOnUiThread {
                            coinsBalance = coins
                            updateCoinsDisplay()
                            Toast.makeText(
                                this,
                                "Order not placed — $reason.",
                                Toast.LENGTH_LONG
                            ).show()
                        }
                    }
                }
            }

            if (token.isBlank()) {
                refreshTokenSilently { fresh -> doOrder(fresh) }
            } else {
                doOrder(token)
            }
        }.start()
    }

    private fun submitPlayBoostOrder(
        token: String,
        product: SocialBoostApi.BoostProduct,
        billingId: String,
        secUid: String,
        handle: String
    ) {
        val isLikes = (product.productType ?: "").contains("Like", ignoreCase = true)

        if (isLikes && selectedVideoUrl.isNullOrBlank()) {
            Toast.makeText(this, getString(R.string.tt_video_required), Toast.LENGTH_LONG).show()
            showChooseVideoDialog()
            return
        }

        val postPk = if (isLikes) selectedVideoPostPk else null
        val targetUrl = if (isLikes) selectedVideoUrl!! else "https://www.tiktok.com/@$handle"

        Thread {
            fun doPlayOrder(authToken: String) {
                try {
                    val result = SocialBoostApi.createOrder(
                        token = authToken,
                        secUid = secUid,
                        username = handle,
                        url = targetUrl,
                        productId = product.id,
                        postPk = postPk
                    )

                    val orderId = result.optInt("id", 0)
                    pendingPlayOrderId = orderId

                    runOnUiThread {
                        if (billingManager.isBillingReady()) {
                            billingManager.launchPurchaseFlow(billingId, orderId)
                        } else {
                            Toast.makeText(this, "Order #$orderId created! Google Play is connecting.", Toast.LENGTH_LONG).show()
                        }
                    }
                } catch (e: Exception) {
                    if (e is SocialBoostApi.ApiException && e.errorCode == "TokenExpired") {
                        refreshTokenSilently { fresh -> doPlayOrder(fresh) }
                    } else {
                        Log.w("HomeActivity", "play order: ${e.message}")
                        runOnUiThread {
                            if (billingManager.isBillingReady()) {
                                billingManager.launchPurchaseFlow(billingId)
                            } else {
                                Toast.makeText(this, "Payment order initiated for $billingId", Toast.LENGTH_LONG).show()
                            }
                        }
                    }
                }
            }

            if (token.isBlank()) {
                refreshTokenSilently { fresh -> doPlayOrder(fresh) }
            } else {
                doPlayOrder(token)
            }
        }.start()
    }

    /**
     * Withdraw the order that was created before Google Play was launched, when the
     * purchase did not go through.
     *
     * The order is created first and paid second, so every failed or abandoned
     * payment otherwise leaves a Pending row behind. It is not served in the task
     * feed (only Progress orders are) and /payment/notify never receives a token for
     * it, so it can never be activated — the user just sees "I ordered followers and
     * nothing is happening". Nothing was charged either way, so removing it is the
     * honest response.
     */
    private fun withdrawUnpaidPlayOrder() {
        val orderId = pendingPlayOrderId
        if (orderId <= 0) return
        pendingPlayOrderId = 0

        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null)
        if (token.isNullOrBlank()) return

        Thread {
            try {
                SocialBoostApi.cancelOrder(token, orderId)
                runOnUiThread {
                    Toast.makeText(
                        this,
                        "Payment not completed — order #$orderId was cancelled. Nothing was charged.",
                        Toast.LENGTH_LONG
                    ).show()
                }
            } catch (e: Exception) {
                Log.w("HomeActivity", "cancel pending order $orderId failed: ${e.message}")
                runOnUiThread {
                    Toast.makeText(
                        this,
                        "Payment not completed — nothing was charged. Order #$orderId is still listed as unpaid; " +
                            "open My orders to withdraw it.",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }.start()
    }

    /** Clear the session so the next launch shows the sign-in screen. */
    private fun signOut() {
        prefs.edit()
            .remove(Constants.KEY_AUTH_TOKEN)
            .remove(Constants.KEY_SEC_UID)
            .remove(Constants.KEY_TIKTOK_USERNAME)
            .remove(Constants.KEY_LOGIN_ID)
            .apply()

        startActivity(
            Intent(this, com.Fahim101.tomquiz.MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        )
        finish()
    }

    /**
     * Pull a page of tasks and show the first one.
     *
     * `pageToLoad` decides which page to ask for. The feed is filtered per viewer —
     * a task leaves it the moment the viewer skips it — so re-asking for page 1 after
     * draining it always comes back empty. When the queue drains we therefore walk
     * forward (page 2, 3, …) rather than asking for page 1 again. `nextPage` remembers
     * where to continue from; a pull-to-refresh restarts at page 1.
     *
     * @param showSpinner false when we are topping up after draining a page — the
     *   card that was just completed should stay on screen rather than flash away.
     */
    private fun loadTasks(showSpinner: Boolean = true, pageToLoad: Int = nextPage) {
        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null)
        if (token.isNullOrBlank()) {
            swipeTasks.isRefreshing = false
            showTaskState(loading = false, message = "Sign in to start earning coins.")
            return
        }

        // A swipe-refresh keeps the current card on screen; only a cold load (no
        // task on screen) shows the full-screen spinner. Otherwise pulling replaces
        // the card with a spinner and the screen appears to reset.
        if (showSpinner && !swipeTasks.isRefreshing && currentTask == null) {
            showTaskState(loading = true)
        }

        Thread {
            try {
                val secUid = prefs.getString(Constants.KEY_SEC_UID, null)
                val handle = prefs.getString(Constants.KEY_TIKTOK_USERNAME, null)
                val page = SocialBoostApi.fetchTasks(token, secUid, handle, pageToLoad)

                runOnUiThread {
                    swipeTasks.isRefreshing = false
                    taskQueue.clear()
                    taskQueue.addAll(page.items)
                    // Continue from the next page once this one is drained. If the
                    // server says there is nothing more, stay put and let the next
                    // drain re-ask page 1 (the self-healing path below).
                    nextPage = if (page.hasNext) page.page + 1 else 1
                    showNextTask()
                }
            } catch (e: Exception) {
                Log.w("HomeActivity", "Task feed failed: ${e.message}")
                runOnUiThread {
                    swipeTasks.isRefreshing = false
                    showTaskState(loading = false, message = "Could not load tasks. Pull to retry.")
                }
            }
        }.start()
    }

    private fun showNextTask() {
        pendingVerificationTask = null
        hasActionBeenOpened = false
        val next = taskQueue.removeFirstOrNull()
        currentTask = next

        if (next == null) {
            // We only fetched one page. The server still holds tasks we have not been
            // credited for, so ask for them before declaring the screen empty —
            // otherwise tasks run out after ~10 and never come back on their own.
            //
            // This is also why Skip used to look broken: the refetch was silent, so
            // skipping the last card on a page left the *same* card on screen for the
            // whole round-trip. On a cold Vercel start that is seconds of a button
            // that appears dead. Show a spinner so the tap is visibly acknowledged.
            if (!drainedPageRefetched) {
                drainedPageRefetched = true
                currentTask = null
                showTaskState(loading = true, message = "Finding more tasks…")
                loadTasks(showSpinner = false)
                return
            }
            showTaskState(loading = false, message = getString(R.string.tt_no_tasks))
            return
        }

        drainedPageRefetched = false
        layoutTaskEmpty.visibility = View.GONE
        scrollTask.visibility = View.VISIBLE

        tvTaskUsername.text = "@${next.username}"
        tvTaskFollowLabel.text = if (next.isLikes) "Like" else getString(R.string.tt_follow)
        tvTaskReward.text = "+${next.rewardCoins}"
        btnTaskFollow.isEnabled = true
        btnTaskFollow.alpha = 1f

        // Try the server mirror first, then whatever URL the feed supplied. The raw URL
        // is a signed TikTok CDN link that expires, so on its own it eventually 403s and
        // the card loses its picture.
        Avatars.load(ivTaskAvatar, Avatars.candidates(next.username, next.imageUrl), next.username)
    }

    private fun showTaskState(loading: Boolean, message: String? = null) {
        scrollTask.visibility = View.GONE
        layoutTaskEmpty.visibility = View.VISIBLE
        progressTaskLoading.visibility = if (loading) View.VISIBLE else View.GONE
        tvTaskEmpty.text = if (loading) {
            // A caller-supplied message distinguishes "fetching the next page after
            // you skipped the last card" from the initial cold load.
            message ?: getString(R.string.tt_loading_tasks)
        } else {
            message ?: getString(R.string.tt_no_tasks)
        }
        // A spinner left running would block the next swipe gesture.
        if (!loading) swipeTasks.isRefreshing = false
    }

    /** Skip: tell the server, then advance to the next task. */
    private fun skipCurrentTask() {
        val task = currentTask ?: return
        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null) ?: return

        pendingVerificationTask = null
        hasActionBeenOpened = false
        // A tap on Follow puts the verifier in flight; if the user then skips, that
        // in-flight check belongs to a task that is no longer on screen. Leaving
        // isVerifying set used to block every later verification on this screen —
        // the Follow button silently did nothing until the app was restarted.
        isVerifying = false

        // Advance immediately — the skip call is fire-and-forget.
        showNextTask()

        Thread {
            try {
                SocialBoostApi.skipTask(
                    token,
                    task.orderId,
                    prefs.getString(Constants.KEY_SEC_UID, null),
                    prefs.getString(Constants.KEY_TIKTOK_USERNAME, null)
                )
            } catch (e: Exception) {
                Log.w("HomeActivity", "skip-count failed: ${e.message}")
            }
        }.start()
    }

    /**
     * Follow/Like: open the target in TikTok, then verify when user returns.
     * Coins are ONLY credited after confirming the follow/like action.
     */
    private fun completeCurrentTask() {
        val task = currentTask ?: return
        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null) ?: return
        if (isVerifying) return

        // If the user already opened TikTok for this task and taps again:
        if (hasActionBeenOpened && pendingVerificationTask?.orderId == task.orderId) {
            val elapsed = System.currentTimeMillis() - taskOpenedTimestamp
            if (elapsed < 2000) {
                val action = if (task.isLikes) "like the video" else "follow @${task.username}"
                Toast.makeText(this, "Please $action on TikTok first!", Toast.LENGTH_SHORT).show()
                openTikTokForTask(task)
                return
            }
            // User was away and tapped to verify:
            runTaskVerification(task, token)
            return
        }

        // First click: record pending task, timestamp, change button to check state, open TikTok
        pendingVerificationTask = task
        taskOpenedTimestamp = System.currentTimeMillis()
        hasActionBeenOpened = true

        tvTaskFollowLabel.text = "Check ⚡"

        // A like is verified by comparing the video's like count before and after, so
        // the "before" snapshot has to be stored *now* — before the user can possibly
        // tap Like. TikTok is opened only once the snapshot is saved, otherwise a fast
        // user could like the video first and the baseline would already include their
        // own like, permanently denying them the reward.
        if (task.isLikes) {
            Thread {
                try {
                    SocialBoostApi.primeLikeBaseline(
                        token = token,
                        orderId = task.orderId,
                        url = task.url,
                        ttUsername = prefs.getString(Constants.KEY_TIKTOK_USERNAME, null).orEmpty(),
                        secUid = prefs.getString(Constants.KEY_SEC_UID, null)
                    )
                } catch (e: Exception) {
                    Log.w("HomeActivity", "like baseline failed: ${e.message}")
                }
                runOnUiThread { openTikTokForTask(task) }
            }.start()
        } else {
            openTikTokForTask(task)
        }
    }

    private fun openTikTokForTask(task: SocialBoostApi.TaskItem) {
        val openUrl = task.url.ifBlank { "https://www.tiktok.com/@${task.username}" }
        try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(openUrl))
            startActivity(intent)
            val action = if (task.isLikes) "Like the video" else "Follow @${task.username}"
            Toast.makeText(this, "$action on TikTok, then return here to claim your coins!", Toast.LENGTH_LONG).show()
        } catch (e: Exception) {
            Toast.makeText(this, "Could not open TikTok. Please check link.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun handleTaskReturnOnResume() {
        val task = pendingVerificationTask ?: return
        if (!hasActionBeenOpened || isVerifying) return

        val elapsed = System.currentTimeMillis() - taskOpenedTimestamp
        if (elapsed >= 2200) {
            // User stayed in TikTok long enough to perform the action -> verify automatically!
            val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null)
            if (!token.isNullOrBlank()) {
                runTaskVerification(task, token)
            }
        } else {
            // User came back immediately without following:
            tvTaskFollowLabel.text = "Check ⚡"
            val action = if (task.isLikes) "like" else "follow"
            Toast.makeText(
                this,
                "Please complete the $action on TikTok to earn coins!",
                Toast.LENGTH_SHORT
            ).show()
        }
    }

    private fun runTaskVerification(task: SocialBoostApi.TaskItem, token: String) {
        if (isVerifying) return
        isVerifying = true
        btnTaskFollow.isEnabled = false
        btnTaskFollow.alpha = 0.6f
        tvTaskFollowLabel.text = "Checking… ⏳"

        val handle = prefs.getString(Constants.KEY_TIKTOK_USERNAME, null).orEmpty()
        val secUid = prefs.getString(Constants.KEY_SEC_UID, null)

        Thread {
            try {
                // Brief verification animation pause so the user sees the checking state
                Thread.sleep(700)

                val earned = SocialBoostApi.verifyTask(
                    token = token,
                    orderId = task.orderId,
                    secUid = secUid,
                    ttUsername = handle,
                    targetUsername = task.username,
                    isLikes = task.isLikes,
                    actionCompleted = true
                )

                runOnUiThread {
                    isVerifying = false
                    btnTaskFollow.isEnabled = true
                    btnTaskFollow.alpha = 1f

                    if (earned > 0) {
                        coinsBalance += earned
                        prefs.edit().putInt(Constants.KEY_COINS, coinsBalance).apply()
                        updateCoinsDisplay()

                        val action = if (task.isLikes) "Like" else "Follow"
                        Toast.makeText(
                            this,
                            "🎉 $action verified! +$earned Coins added!",
                            Toast.LENGTH_LONG
                        ).show()

                        pendingVerificationTask = null
                        hasActionBeenOpened = false
                        showNextTask()
                    } else {
                        // Not verified
                        val action = if (task.isLikes) "Like" else getString(R.string.tt_follow)
                        tvTaskFollowLabel.text = action
                        Toast.makeText(
                            this,
                            "Could not verify. Please complete the action on TikTok to earn coins.",
                            Toast.LENGTH_LONG
                        ).show()
                        pendingVerificationTask = null
                        hasActionBeenOpened = false
                    }
                }
            } catch (e: Exception) {
                Log.w("HomeActivity", "coins/check failed: ${e.message}")
                runOnUiThread {
                    isVerifying = false
                    btnTaskFollow.isEnabled = true
                    btnTaskFollow.alpha = 1f
                    val action = if (task.isLikes) "Like" else getString(R.string.tt_follow)
                    tvTaskFollowLabel.text = action
                    Toast.makeText(
                        this,
                        e.message ?: "Verification failed",
                        Toast.LENGTH_LONG
                    ).show()
                    pendingVerificationTask = null
                    hasActionBeenOpened = false
                }
            }
        }.start()
    }

    // ------------------------------------------------------------------
    // Store: unlock a source code with coins
    // ------------------------------------------------------------------

    /**
     * Pull the server's coin prices and this account's unlocks.
     *
     * The price is fetched rather than derived so the client can never offer a
     * number the backend would reject. The unlock list is authoritative too: a
     * coin unlock has no Google Play record, so this is the only thing that
     * restores it after a reinstall.
     */
    private fun loadCodePrices() {
        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null) ?: return

        Thread {
            try {
                val prices = SocialBoostApi.fetchCodes(token).associate { it.codeId to it.coinsPrice }

                val unlocked = try {
                    SocialBoostApi.fetchUnlockedCodes(token)
                } catch (e: Exception) {
                    Log.w("HomeActivity", "unlocked fetch failed: ${e.message}")
                    emptyList()
                }

                runOnUiThread {
                    codeCoinPrices = prices
                    allCodesList.forEach { it.coinsPrice = codeCoinPrices[it.id] ?: 0 }

                    if (unlocked.isNotEmpty()) {
                        val stored =
                            prefs.getStringSet(Constants.KEY_COIN_UNLOCKED_IDS, emptySet())
                                ?: emptySet()
                        prefs.edit()
                            .putStringSet(
                                Constants.KEY_COIN_UNLOCKED_IDS,
                                HashSet(stored).apply { addAll(unlocked) }
                            )
                            .apply()
                    }

                    applyPurchasedState()
                }
            } catch (e: Exception) {
                Log.w("HomeActivity", "code prices failed: ${e.message}")
            }
        }.start()
    }

    private fun buyCodeWithCoins(item: CodeItem) {
        if (item.isPurchased || isSubscriptionActive) {
            openCodeRepository(item)
            return
        }

        val coinsPrice = if (item.coinsPrice > 0) item.coinsPrice else 500
        if (coinsBalance < coinsPrice) {
            val shortage = coinsPrice - coinsBalance
            AlertDialog.Builder(this)
                .setTitle("Need More Coins 🪙")
                .setMessage("You need $coinsPrice coins to unlock this code.\nYour current balance is $coinsBalance coins ($shortage more needed).\n\nComplete TikTok tasks to earn free coins, or top up with a Coin Pack!")
                .setPositiveButton("Earn Free Coins ⚡") { _, _ -> selectTab(0) }
                .setNeutralButton("Top Up Coins 🪙") { _, _ -> selectTab(1) }
                .setNegativeButton("Cancel", null)
                .show()
            return
        }

        AlertDialog.Builder(this)
            .setTitle("Unlock Source Code 🪙")
            .setMessage("Spend $coinsPrice coins to permanently unlock full source code and GitHub repository for:\n\n'${item.title}'?\n\nRemaining coins after unlock: ${coinsBalance - coinsPrice}")
            .setPositiveButton("Unlock Now 🚀") { _, _ ->
                coinsBalance -= coinsPrice
                updateCoinsDisplay()

                val coinOwned = prefs.getStringSet(Constants.KEY_COIN_UNLOCKED_IDS, emptySet()) ?: emptySet()
                val updated = HashSet(coinOwned).apply { add(item.id) }
                prefs.edit().putStringSet(Constants.KEY_COIN_UNLOCKED_IDS, updated).apply()

                applyPurchasedState()
                performCoinUnlock(item)
                showUnlockedSuccessDialog(item)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun buyCodeWithCash(item: CodeItem) {
        if (item.isPurchased || isSubscriptionActive) {
            openCodeRepository(item)
            return
        }

        if (billingManager.isBillingReady()) {
            billingManager.launchPurchaseFlow(item.productId)
        } else {
            showPurchaseDialog(item)
        }
    }

    private fun openCodeRepository(item: CodeItem) {
        showUnlockedSuccessDialog(item)
    }

    private fun showUnlockedSuccessDialog(item: CodeItem) {
        val message = "🎉 '${item.title}' is Unlocked!\n\nGitHub Repo:\n${item.repoUrl}\n\nLive Demo:\n${item.webLink}"
        AlertDialog.Builder(this)
            .setTitle("Code Access Ready 🚀")
            .setMessage(message)
            .setPositiveButton("Open GitHub") { _, _ ->
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(item.repoUrl))
                    startActivity(intent)
                } catch (e: Exception) {
                    Toast.makeText(this, "Could not open browser: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
            .setNeutralButton("Copy GitHub URL") { _, _ ->
                val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = ClipData.newPlainText("Repository URL", item.repoUrl)
                clipboard.setPrimaryClip(clip)
                Toast.makeText(this, "Repository link copied to clipboard! 📋", Toast.LENGTH_LONG).show()
            }
            .setNegativeButton("Close", null)
            .show()
    }

    /**
     * Spend the coins and unlock on server in background.
     */
    private fun performCoinUnlock(item: CodeItem) {
        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null)

        Thread {
            fun doUnlock(authToken: String) {
                try {
                    SocialBoostApi.unlockCode(authToken, item.id)
                } catch (e: Exception) {
                    if (e is SocialBoostApi.ApiException && e.errorCode == "TokenExpired") {
                        refreshTokenSilently { fresh -> doUnlock(fresh) }
                    } else {
                        Log.w("HomeActivity", "backend code unlock note: ${e.message}")
                    }
                }
            }

            if (!token.isNullOrBlank()) {
                doUnlock(token)
            } else {
                refreshTokenSilently { fresh -> doUnlock(fresh) }
            }
        }.start()
    }

    private fun setupBuyCodesScreen() {
        allCodesList = Constants.getCodeCatalog()
        applyPurchasedState()

        buyCodesAdapter = BuyCodesAdapter(
            codeList = allCodesList,
            priceProvider = { productId -> billingManager.getFormattedPrice(productId) },
            isSubscriptionActive = { isSubscriptionActive },
            onItemClickListener = { codeItem -> showPurchaseDialog(codeItem) },
            onBuyCashClickListener = { codeItem -> buyCodeWithCash(codeItem) },
            onBuyCoinsClickListener = { codeItem -> buyCodeWithCoins(codeItem) },
            onOpenCodeClickListener = { codeItem -> openCodeRepository(codeItem) },
            onImageClickListener = { codeItem -> showFullScreenImage(codeItem, 0) }
        )

        rvBuyCodes.layoutManager = LinearLayoutManager(this)
        rvBuyCodes.isNestedScrollingEnabled = false
        rvBuyCodes.adapter = buyCodesAdapter

        tvSubBadge = findViewById(R.id.tv_sub_badge)
        tvSubTitle = findViewById(R.id.tv_sub_title)
        tvSubSubtitle = findViewById(R.id.tv_sub_subtitle)
        tvSubPrice = findViewById(R.id.tv_sub_price)
        val btnSubscribe5Usd: Button = findViewById(R.id.btn_subscribe_5usd)
        this.btnSubscribe5Usd = btnSubscribe5Usd
        btnSubscribe5Usd.setOnClickListener {
            if (isSubscriptionActive) {
                openGooglePlaySubscriptions()
            } else {
                billingManager.launchSubscriptionFlow(Constants.SUBSCRIPTION_PRODUCT_ID)
            }
        }
        updateSubscriptionBannerState()

        val btnRestorePurchases: TextView = findViewById(R.id.btn_restore_purchases)
        btnRestorePurchases.setOnClickListener {
            if (!billingManager.isBillingReady()) {
                Toast.makeText(this, "Still connecting to Google Play - try again in a moment", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            Toast.makeText(this, "Checking your Google Play purchases…", Toast.LENGTH_SHORT).show()
            refreshOwnedPurchases(notifyUser = true)
        }

        setupFilterChips()
        fetchProjectsFromApi()
        loadCodePrices()
    }

    private var currentFilterKey = "All"

    private fun fetchProjectsFromApi() {
        Thread {
            try {
                val url = URL(Constants.PROJECTS_API_URL)
                val connection = url.openConnection() as HttpURLConnection
                connection.requestMethod = "GET"
                connection.connectTimeout = 6000
                connection.readTimeout = 6000
                connection.connect()

                if (connection.responseCode == 200) {
                    val jsonText = connection.inputStream.bufferedReader().use { it.readText() }
                    val apiItems = Constants.parseProjectsJson(jsonText)
                    if (apiItems.isNotEmpty()) {
                        runOnUiThread {
                            allCodesList.clear()
                            allCodesList.addAll(apiItems)
                            applyPurchasedState()
                            filterCodes(currentFilterKey)
                        }
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }.start()
    }

    private fun setupFilterChips() {
        val chips = listOf(
            chipFilterAll to "All",
            chipFilterFullstack to "Full-Stack",
            chipFilterMobile to "Mobile",
            chipFilterFrontend to "Frontend",
            chipFilterBackend to "Backend"
        )

        chips.forEach { (chip, catKey) ->
            chip.setOnClickListener {
                chips.forEach { (c, _) ->
                    c.background = ContextCompat.getDrawable(this, R.drawable.option_default_bg)
                    c.setTextColor(ContextCompat.getColor(this, R.color.text_secondary))
                    c.setTypeface(null, Typeface.NORMAL)
                }

                chip.background = ContextCompat.getDrawable(this, R.drawable.option_selected_bg)
                chip.setTextColor(ContextCompat.getColor(this, R.color.white))
                chip.setTypeface(null, Typeface.BOLD)

                filterCodes(catKey)
            }
        }
    }

    private fun filterCodes(catKey: String) {
        currentFilterKey = catKey
        val filtered = when (catKey) {
            "All" -> allCodesList
            "Full-Stack" -> allCodesList.filter {
                it.category.contains("Full-Stack", ignoreCase = true) ||
                it.category.contains("Multivendor", ignoreCase = true) ||
                it.category.contains("eCommerce", ignoreCase = true) ||
                it.title.contains("eCommerce", ignoreCase = true) ||
                it.title.contains("ecomemrce", ignoreCase = true)
            }
            "Mobile" -> allCodesList.filter {
                it.category.contains("Mobile", ignoreCase = true) ||
                it.category.contains("Flutter", ignoreCase = true) ||
                it.category.contains("Kotlin", ignoreCase = true) ||
                it.category.contains("React-Native", ignoreCase = true) ||
                it.title.contains("Flutter", ignoreCase = true) ||
                it.title.contains("Kotlin", ignoreCase = true) ||
                it.title.contains("Mobile", ignoreCase = true)
            }
            "Frontend" -> allCodesList.filter {
                it.category.contains("React", ignoreCase = true) ||
                it.category.contains("Next", ignoreCase = true) ||
                it.category.contains("Angular", ignoreCase = true) ||
                it.title.contains("React", ignoreCase = true)
            }
            "Backend" -> allCodesList.filter {
                it.category.contains("Backend", ignoreCase = true) ||
                it.category.contains("Node", ignoreCase = true) ||
                it.category.contains("asp", ignoreCase = true) ||
                it.category.contains("Django", ignoreCase = true) ||
                it.category.contains("Laravel", ignoreCase = true) ||
                it.category.contains("Php", ignoreCase = true) ||
                it.category.contains("python", ignoreCase = true) ||
                it.category.contains("C#", ignoreCase = true) ||
                it.title.contains("Laravel", ignoreCase = true) ||
                it.title.contains(".NET", ignoreCase = true)
            }
            else -> allCodesList
        }
        buyCodesAdapter.updateList(filtered)
    }

    // ------------------------------------------------------------------
    // Full-screen image viewer
    // ------------------------------------------------------------------

    private fun showFullScreenImage(item: CodeItem, startIndex: Int = 0) {
        val images = item.imageUrls.ifEmpty { listOf(item.imageUrl).filter { it.isNotBlank() } }
        if (images.isEmpty()) {
            Toast.makeText(this, "No preview screenshots available", Toast.LENGTH_SHORT).show()
            return
        }

        val dialog = Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_fullscreen_image, null)
        dialog.setContentView(dialogView)

        val tvTitle: TextView = dialogView.findViewById(R.id.tv_fullscreen_title)
        val tvCounter: TextView = dialogView.findViewById(R.id.tv_image_counter)
        val btnClose: ImageView = dialogView.findViewById(R.id.btn_close_fullscreen)
        val ivFullscreen: ImageView = dialogView.findViewById(R.id.iv_fullscreen)
        val progressFullscreen: ProgressBar = dialogView.findViewById(R.id.progress_fullscreen)
        val tvError: TextView = dialogView.findViewById(R.id.tv_fullscreen_error)
        val btnPrev: ImageView = dialogView.findViewById(R.id.btn_prev_image)
        val btnNext: ImageView = dialogView.findViewById(R.id.btn_next_image)
        val layoutThumbs: LinearLayout = dialogView.findViewById(R.id.layout_fullscreen_thumbs)
        val bottomBar: LinearLayout = dialogView.findViewById(R.id.layout_bottom_bar)
        val topBar: LinearLayout = dialogView.findViewById(R.id.layout_top_bar)

        tvTitle.text = if (item.title.isNotBlank()) item.title else "Project Preview"
        var currentIndex = startIndex.coerceIn(0, images.size - 1)
        var loadImageAction: ((Int) -> Unit)? = null

        fun updateThumbs() {
            layoutThumbs.removeAllViews()
            if (images.size <= 1) {
                layoutThumbs.visibility = View.GONE
                btnPrev.visibility = View.GONE
                btnNext.visibility = View.GONE
                return
            }
            layoutThumbs.visibility = View.VISIBLE
            btnPrev.visibility = if (currentIndex > 0) View.VISIBLE else View.GONE
            btnNext.visibility = if (currentIndex < images.size - 1) View.VISIBLE else View.GONE

            images.forEachIndexed { idx, url ->
                val thumbView = ShapeableImageView(this).apply {
                    val w = (64 * resources.displayMetrics.density).toInt()
                    val h = (44 * resources.displayMetrics.density).toInt()
                    val m = (4 * resources.displayMetrics.density).toInt()
                    layoutParams = LinearLayout.LayoutParams(w, h).apply {
                        setMargins(m, 0, m, 0)
                    }
                    scaleType = ImageView.ScaleType.CENTER_CROP
                    background = ContextCompat.getDrawable(
                        this@HomeActivity,
                        if (idx == currentIndex) R.drawable.tt_thumb_selected_bg else R.drawable.tt_thumb_normal_bg
                    )
                    setPadding(3, 3, 3, 3)
                }

                Glide.with(this@HomeActivity)
                    .load(url)
                    .diskCacheStrategy(DiskCacheStrategy.ALL)
                    .placeholder(R.drawable.bg_gradient_dark)
                    .error(R.drawable.bg_gradient_dark)
                    .into(thumbView)

                thumbView.setOnClickListener {
                    if (currentIndex != idx) {
                        currentIndex = idx
                        loadImageAction?.invoke(currentIndex)
                    }
                }
                layoutThumbs.addView(thumbView)
            }
        }

        fun loadImage(index: Int) {
            tvCounter.text = "${index + 1} / ${images.size}"
            tvError.visibility = View.GONE
            progressFullscreen.visibility = View.VISIBLE

            Glide.with(this@HomeActivity)
                .load(images[index])
                .diskCacheStrategy(DiskCacheStrategy.ALL)
                .placeholder(R.drawable.bg_gradient_dark)
                .error(R.drawable.bg_gradient_dark)
                .listener(object : RequestListener<Drawable> {
                    override fun onLoadFailed(
                        e: GlideException?,
                        model: Any?,
                        target: Target<Drawable>?,
                        isFirstResource: Boolean
                    ): Boolean {
                        Log.e("FullScreenImage", "Failed to load image at index $index: ${images[index]}", e)
                        progressFullscreen.visibility = View.GONE
                        tvError.visibility = View.VISIBLE
                        return false
                    }

                    override fun onResourceReady(
                        resource: Drawable?,
                        model: Any?,
                        target: Target<Drawable>?,
                        dataSource: DataSource?,
                        isFirstResource: Boolean
                    ): Boolean {
                        progressFullscreen.visibility = View.GONE
                        tvError.visibility = View.GONE
                        return false
                    }
                })
                .fitCenter()
                .into(ivFullscreen)

            updateThumbs()
        }

        loadImageAction = { loadImage(it) }

        btnPrev.setOnClickListener {
            if (currentIndex > 0) {
                currentIndex--
                loadImage(currentIndex)
            }
        }

        btnNext.setOnClickListener {
            if (currentIndex < images.size - 1) {
                currentIndex++
                loadImage(currentIndex)
            }
        }

        tvError.setOnClickListener {
            loadImage(currentIndex)
        }

        btnClose.setOnClickListener { dialog.dismiss() }

        var downX = 0f
        var downY = 0f
        ivFullscreen.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.x
                    downY = event.y
                    true
                }
                MotionEvent.ACTION_UP -> {
                    val deltaX = event.x - downX
                    val deltaY = event.y - downY
                    if (Math.abs(deltaX) > 80 && Math.abs(deltaX) > Math.abs(deltaY)) {
                        if (deltaX < 0 && currentIndex < images.size - 1) {
                            currentIndex++
                            loadImage(currentIndex)
                        } else if (deltaX > 0 && currentIndex > 0) {
                            currentIndex--
                            loadImage(currentIndex)
                        }
                    } else if (Math.abs(deltaX) < 20 && Math.abs(deltaY) < 20) {
                        val newVis = if (topBar.visibility == View.VISIBLE) View.GONE else View.VISIBLE
                        topBar.visibility = newVis
                        bottomBar.visibility = newVis
                    }
                    true
                }
                else -> false
            }
        }

        dialog.show()
        dialog.window?.let { win ->
            win.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
            win.setBackgroundDrawable(ColorDrawable(Color.BLACK))
            win.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
            win.statusBarColor = Color.BLACK
            win.navigationBarColor = Color.BLACK
        }
        loadImage(currentIndex)
    }

    // ------------------------------------------------------------------
    // Purchase dialog
    // ------------------------------------------------------------------

    private fun showPurchaseDialog(item: CodeItem) {
        val dialogView = LayoutInflater.from(this).inflate(R.layout.dialog_purchase_code, null)
        val dialog = AlertDialog.Builder(this)
            .setView(dialogView)
            .setCancelable(true)
            .create()

        dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        activeDialog = dialog
        activeItem = item
        isSubscriptionSelected = false

        val tvTitleHeader: TextView = dialogView.findViewById(R.id.dialog_title_header)
        val btnClose: ImageView = dialogView.findViewById(R.id.dialog_btn_close)
        val tvProductTitle: TextView = dialogView.findViewById(R.id.dialog_product_title)
        val tvProductPrice: TextView = dialogView.findViewById(R.id.dialog_product_price)
        val tvDeliveryType: TextView = dialogView.findViewById(R.id.dialog_tv_delivery_type)

        val layoutCheckoutForm: LinearLayout = dialogView.findViewById(R.id.layout_checkout_form)
        val etPromo: EditText = dialogView.findViewById(R.id.dialog_et_promo)
        val btnApplyPromo: Button = dialogView.findViewById(R.id.dialog_btn_apply_promo)
        val tvPromoApplied: TextView = dialogView.findViewById(R.id.dialog_tv_promo_applied)
        val tvBillingStatus: TextView = dialogView.findViewById(R.id.dialog_tv_billing_status)
        val btnConfirmPurchase: Button = dialogView.findViewById(R.id.dialog_btn_confirm_purchase)

        val layoutUnlockedCode: LinearLayout = dialogView.findViewById(R.id.layout_unlocked_code)
        val tvRepoUrl: TextView = dialogView.findViewById(R.id.dialog_tv_repo_url)
        val btnCopyRepo: ImageView = dialogView.findViewById(R.id.dialog_btn_copy_repo)
        val tvCodeSnippet: TextView = dialogView.findViewById(R.id.dialog_tv_code_snippet)
        val btnOpenGithub: Button? = dialogView.findViewById(R.id.dialog_btn_open_github)
        val btnRefreshProducts: Button? = dialogView.findViewById(R.id.dialog_btn_refresh_products)
        val btnRestorePurchases: Button? = dialogView.findViewById(R.id.dialog_btn_restore_purchases)
        val btnWebLink: Button? = dialogView.findViewById(R.id.dialog_btn_web_link)
        val btnDone: Button = dialogView.findViewById(R.id.dialog_btn_done)

        val ivProjectImage: ImageView? = dialogView.findViewById(R.id.dialog_iv_project_image)
        val tvDescription: TextView? = dialogView.findViewById(R.id.dialog_tv_description)
        val tvFeatures: TextView? = dialogView.findViewById(R.id.dialog_tv_features)
        val scrollGallery: View? = dialogView.findViewById(R.id.dialog_scroll_gallery)
        val layoutGallery: LinearLayout? = dialogView.findViewById(R.id.dialog_layout_gallery)

        // Keep live references so billing callbacks can update this dialog in place.
        activeTitleHeader = tvTitleHeader
        activeCheckoutForm = layoutCheckoutForm
        activeUnlockedLayout = layoutUnlockedCode
        activeBillingStatus = tvBillingStatus
        activeBuyButton = btnConfirmPurchase
        activePriceLabel = tvProductPrice
        activeDeliveryLabel = tvDeliveryType

        if (item.imageUrl.isNotBlank() && ivProjectImage != null) {
            ivProjectImage.visibility = View.VISIBLE
            Glide.with(this)
                .load(item.imageUrl)
                .placeholder(R.drawable.bg_gradient_dark)
                .error(R.drawable.bg_gradient_dark)
                .into(ivProjectImage)
            ivProjectImage.setOnClickListener { showFullScreenImage(item, 0) }
        } else {
            ivProjectImage?.visibility = View.GONE
        }

        if (item.imageUrls.isNotEmpty() && layoutGallery != null) {
            layoutGallery.removeAllViews()
            scrollGallery?.visibility = View.VISIBLE
            item.imageUrls.forEachIndexed { index, imgUrl ->
                val imgView = ShapeableImageView(this).apply {
                    val widthPx = (120 * resources.displayMetrics.density).toInt()
                    val heightPx = (80 * resources.displayMetrics.density).toInt()
                    val marginPx = (8 * resources.displayMetrics.density).toInt()
                    layoutParams = LinearLayout.LayoutParams(widthPx, heightPx).apply {
                        setMargins(0, 0, marginPx, 0)
                    }
                    scaleType = ImageView.ScaleType.CENTER_CROP
                }
                Glide.with(this)
                    .load(imgUrl)
                    .placeholder(R.drawable.bg_gradient_dark)
                    .error(R.drawable.bg_gradient_dark)
                    .into(imgView)

                imgView.setOnClickListener {
                    showFullScreenImage(item, index)
                }
                layoutGallery.addView(imgView)
            }
        } else {
            scrollGallery?.visibility = View.GONE
        }

        tvDescription?.text = item.description
        if (item.features.isNotEmpty()) {
            tvFeatures?.visibility = View.VISIBLE
            tvFeatures?.text = item.features.joinToString("\n") { "✔ $it" }
        } else {
            tvFeatures?.visibility = View.GONE
        }

        tvProductTitle.text = item.title
        tvRepoUrl.text = item.repoUrl
        tvCodeSnippet.text = item.sampleSnippet

        val tvUnlockedStatus: TextView? = dialogView.findViewById(R.id.dialog_tv_unlocked_status)
        val btnBuyLifetime: Button? = dialogView.findViewById(R.id.dialog_btn_buy_lifetime)

        val isOwned = item.isPurchased
        val hasPass = isSubscriptionActive

        if (isOwned) {
            tvTitleHeader.text = "Unlocked Code & Repository"
            tvUnlockedStatus?.text = "Purchase Successful! Code Unlocked 🎉"
            btnBuyLifetime?.visibility = View.GONE
            layoutCheckoutForm.visibility = View.GONE
            layoutUnlockedCode.visibility = View.VISIBLE
        } else if (hasPass) {
            tvTitleHeader.text = "Unlocked with All-Access Pass 👑"
            tvUnlockedStatus?.text = "Unlocked with Active All-Access Pass 👑"
            val playPrice = billingManager.getFormattedPrice(item.productId) ?: item.price
            btnBuyLifetime?.text = "⚡ Buy Lifetime Ownership with Google Play ($playPrice)"
            btnBuyLifetime?.visibility = View.VISIBLE
            btnBuyLifetime?.setOnClickListener {
                billingManager.launchPurchaseFlow(item.productId)
            }
            layoutCheckoutForm.visibility = View.GONE
            layoutUnlockedCode.visibility = View.VISIBLE
        } else {
            tvTitleHeader.text = "Unlock Source Code"
            btnBuyLifetime?.visibility = View.GONE
            layoutCheckoutForm.visibility = View.VISIBLE
            layoutUnlockedCode.visibility = View.GONE
        }

        // Coin unlock is an *alternative* to paying, so it only appears when the
        // code is not already accessible and the server published a price for it.
        val btnUnlockCoins: Button? = dialogView.findViewById(R.id.dialog_btn_unlock_coins)
        val coinsPrice = item.coinsPrice
        val canUseCoins = !isOwned && !hasPass && coinsPrice > 0
        btnUnlockCoins?.visibility = if (canUseCoins) View.VISIBLE else View.GONE
        if (canUseCoins) {
            btnUnlockCoins?.text = getString(R.string.tt_code_unlock_button, coinsPrice)
            btnUnlockCoins?.setOnClickListener {
                activeDialog?.dismiss()
                buyCodeWithCoins(item)
            }
        }

        // --- Purchase mode toggle -------------------------------------
        val layoutOptionOneTime: LinearLayout = dialogView.findViewById(R.id.layout_option_onetime)
        val ivOneTimeCheck: ImageView = dialogView.findViewById(R.id.dialog_iv_onetime_check)
        val layoutOptionSubscription: LinearLayout = dialogView.findViewById(R.id.layout_option_subscription)
        val ivSubCheck: ImageView = dialogView.findViewById(R.id.dialog_iv_sub_check)
        activeSubPriceLabel = dialogView.findViewById(R.id.dialog_tv_sub_price)

        layoutOptionOneTime.setOnClickListener {
            isSubscriptionSelected = false
            layoutOptionOneTime.background = ContextCompat.getDrawable(this, R.drawable.option_selected_bg)
            ivOneTimeCheck.visibility = View.VISIBLE
            layoutOptionSubscription.background = ContextCompat.getDrawable(this, R.drawable.option_default_bg)
            ivSubCheck.visibility = View.INVISIBLE
            syncActiveDialog()
        }

        layoutOptionSubscription.setOnClickListener {
            isSubscriptionSelected = true
            layoutOptionSubscription.background = ContextCompat.getDrawable(this, R.drawable.option_selected_bg)
            ivSubCheck.visibility = View.VISIBLE
            layoutOptionOneTime.background = ContextCompat.getDrawable(this, R.drawable.option_default_bg)
            ivOneTimeCheck.visibility = View.INVISIBLE
            syncActiveDialog()
        }

        btnClose.setOnClickListener { dialog.dismiss() }

        // --- Promo code -------------------------------------------------
        // NOTE: a client-side promo cannot change what Google Play charges. Promo codes
        // therefore grant bonus coins rather than displaying a price the user will never pay.
        btnApplyPromo.setOnClickListener {
            val code = etPromo.text.toString().trim()
            if (code.equals("DEVQUIZ25", ignoreCase = true) || code.equals("PROQUIZ20", ignoreCase = true)) {
                tvPromoApplied.visibility = View.VISIBLE
                tvPromoApplied.text = "✔ Promo accepted - 250 bonus coins added"
                coinsBalance += 250
                updateCoinsDisplay()
                Toast.makeText(this, "Promo accepted - 250 bonus coins added", Toast.LENGTH_SHORT).show()
            } else {
                tvPromoApplied.visibility = View.GONE
                Toast.makeText(this, "Invalid promo code", Toast.LENGTH_SHORT).show()
            }
        }

        btnConfirmPurchase.setOnClickListener {
            if (isSubscriptionSelected) {
                billingManager.launchSubscriptionFlow(Constants.SUBSCRIPTION_PRODUCT_ID)
            } else {
                billingManager.launchPurchaseFlow(item.productId)
            }
        }

        btnRefreshProducts?.setOnClickListener {
            setBillingStatus("Refreshing product list from Google Play…", isError = false)
            billingManager.refreshProducts()
        }

        btnRestorePurchases?.setOnClickListener {
            setBillingStatus("Checking your Google Play purchases…", isError = false)
            refreshOwnedPurchases(notifyUser = true)
            Toast.makeText(this, "Restoring your purchases…", Toast.LENGTH_SHORT).show()
        }

        btnCopyRepo.setOnClickListener {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = ClipData.newPlainText("Repository URL", item.repoUrl)
            clipboard.setPrimaryClip(clip)
            Toast.makeText(this, "Repository link copied to clipboard!", Toast.LENGTH_SHORT).show()
        }

        btnOpenGithub?.setOnClickListener {
            if (item.repoUrl.isNotBlank()) {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(item.repoUrl)))
            } else {
                Toast.makeText(this, "GitHub repository link unavailable", Toast.LENGTH_SHORT).show()
            }
        }

        btnWebLink?.setOnClickListener {
            val url = if (item.webLink.startsWith("http")) item.webLink else item.repoUrl
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        }

        btnDone.setOnClickListener { dialog.dismiss() }

        syncActiveDialog()
        dialog.show()
        val displayWidth = resources.displayMetrics.widthPixels
        dialog.window?.setLayout((displayWidth * 0.95).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    /**
     * Refresh the open dialog against the real Google Play catalog:
     * real localised price, correct CTA label, and a disabled button until
     * the product is actually purchasable.
     */
    private fun syncActiveDialog() {
        val item = activeItem ?: return
        val buyButton = activeBuyButton ?: return

        if (isSubscriptionSelected) {
            val subPrice = billingManager.getSubscriptionFormattedPrice()
            activePriceLabel?.text = subPrice?.let { "$it / mo" } ?: "$5.00 USD / mo"
            activeDeliveryLabel?.text = " • Subscription • Unlocks every code"
            buyButton.text = subPrice?.let { "Subscribe for $it / mo" } ?: "Subscribe for $5.00 USD / mo"
            val subAvailable = billingManager.isProductAvailable(Constants.SUBSCRIPTION_PRODUCT_ID)
            buyButton.isEnabled = subAvailable
            buyButton.alpha = if (subAvailable) 1f else 0.55f
            if (!subAvailable && billingManager.isBillingReady()) {
                setBillingStatus("Subscription is not available on Google Play right now.", isError = true)
            }
            return
        }

        val playPrice = billingManager.getFormattedPrice(item.productId)
        activePriceLabel?.text = playPrice ?: item.price
        activeDeliveryLabel?.text = " • One-time purchase • Lifetime access"
        buyButton.text = "Buy with Google Play (${playPrice ?: item.price})"

        val available = billingManager.isProductAvailable(item.productId)
        buyButton.isEnabled = available
        buyButton.alpha = if (available) 1f else 0.55f

        if (available) {
            setBillingStatus("Ready - Google Play will show the final price at checkout.", isError = false)
        } else if (billingManager.isBillingReady()) {
            setBillingStatus(
                "This code is not purchasable yet: no Google Play product with ID \"${item.productId}\".",
                isError = true
            )
        } else {
            setBillingStatus("Connecting to Google Play…", isError = false)
        }
    }

    /**
     * Update the subscription banner card based on whether the All-Access Pass is active.
     */
    private fun updateSubscriptionBannerState() {
        val subPrice = billingManager.getSubscriptionFormattedPrice()
        if (isSubscriptionActive) {
            tvSubBadge?.text = "👑 PASS ACTIVE"
            tvSubTitle?.text = "All Source Codes Unlocked"
            tvSubSubtitle?.text = "You currently have unlimited access to every codebase with your active All-Access Pass."
            btnSubscribe5Usd?.text = "Subscribed ✓ • Manage in Google Play"
            btnSubscribe5Usd?.background = ContextCompat.getDrawable(this, R.drawable.btn_gradient_emerald)
        } else {
            tvSubBadge?.text = "👑 ALL-ACCESS PASS"
            tvSubTitle?.text = "Unlock ALL Source Codes with Subscription"
            tvSubSubtitle?.text = "Get instant repository access to all full-stack, mobile, backend & React interview codebases."
            btnSubscribe5Usd?.text = subPrice?.let { "Subscribe for $it / Month 👑" } ?: "Subscribe for $5.00 USD / Month 👑"
            btnSubscribe5Usd?.background = ContextCompat.getDrawable(this, R.drawable.btn_gradient_primary)
        }
        if (subPrice != null) {
            tvSubPrice?.text = "$subPrice / mo"
            activeSubPriceLabel?.text = "$subPrice / mo All-Access Pass"
        }
    }

    private fun openGooglePlaySubscriptions() {
        try {
            val uri = Uri.parse("https://play.google.com/store/account/subscriptions?sku=${Constants.SUBSCRIPTION_PRODUCT_ID}&package=$packageName")
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: Exception) {
            try {
                val uri = Uri.parse("https://play.google.com/store/account/subscriptions")
                startActivity(Intent(Intent.ACTION_VIEW, uri))
            } catch (e2: Exception) {
                Toast.makeText(this, "Open Google Play Store > Subscriptions to manage.", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun syncSubscriptionPricing() {
        updateSubscriptionBannerState()
    }

    private fun setBillingStatus(message: String, isError: Boolean) {
        val statusView = activeBillingStatus ?: return
        statusView.visibility = View.VISIBLE
        statusView.text = message
        statusView.setTextColor(
            ContextCompat.getColor(this, if (isError) R.color.accent_rose else R.color.text_secondary)
        )
    }

    private fun showBillingProblemDialog(reason: String) {
        AlertDialog.Builder(this)
            .setTitle("Purchase unavailable")
            .setMessage(reason)
            .setPositiveButton("OK", null)
            .show()
    }

    override fun onDestroy() {
        super.onDestroy()
        activeDialog?.dismiss()
        billingManager.destroy()
    }
}
