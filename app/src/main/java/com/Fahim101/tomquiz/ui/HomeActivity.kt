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
import android.text.Editable
import android.text.TextWatcher
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
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
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.Fahim101.tomquiz.R
import com.bumptech.glide.Glide
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.Fahim101.tomquiz.model.CodeItem
import com.Fahim101.tomquiz.utils.Avatars
import com.Fahim101.tomquiz.utils.BillingManager
import com.Fahim101.tomquiz.utils.Constants
import com.Fahim101.tomquiz.utils.OrderType
import com.Fahim101.tomquiz.utils.Platforms
import com.Fahim101.tomquiz.utils.SocialBoostApi
import com.google.android.material.imageview.ShapeableImageView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.NumberFormat

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

    /** The last /v6/products payload, so coin packs can be looked up by billing id. */
    private var serverProducts: List<SocialBoostApi.BoostProduct> = emptyList()

    /** The coin pack the user tapped, kept so the receipt is credited to the right one. */
    private var pendingCoinPack: SocialBoostApi.BoostProduct? = null

    /** Which tile the New order grid is on. Drives the target picker and the package list. */
    private var selectedOrderType: OrderType = OrderType.DEFAULT

    /** The account's own posts, for the horizontal strip on the New order screen. */
    private val orderVideos = mutableListOf<TikTokVideoSample>()

    /** The strip's adapter, built once and re-notified — the layout is never rebuilt. */
    private var orderVideoAdapter: RecyclerView.Adapter<*>? = null

    /**
     * The handle the strip's posts belong to. Only TikTok can list posts, and the list is
     * the same for every order type, so it is fetched once per account instead of on every
     * tile tap.
     */
    private var orderVideosFetchedFor: String? = null

    // Subscription pricing views, kept in sync with Google Play's localised price
    private var tvSubPrice: TextView? = null
    private var tvSubBadge: TextView? = null
    private var tvSubTitle: TextView? = null
    private var tvSubSubtitle: TextView? = null
    private var btnSubscribe5Usd: Button? = null
    private var activeSubPriceLabel: TextView? = null

    /**
     * Pin the system bars to the app's navy.
     *
     * Necessary because `android:statusBarColor` in the theme is not enough on its own: on
     * Android 12+ the system derives the bar tint from `colorPrimary` when the window does
     * not pin an opaque colour, and it ignores the attribute entirely once an app targets
     * API 35 and defaults to edge-to-edge. The old theme left `colorPrimary` at the previous
     * indigo, so the system painted the bars with it and the app ended up with a lavender
     * status bar over a navy UI — measured rgb(208,188,255), the Material baseline purple,
     * a colour that appears nowhere in this app's palette.
     *
     * Setting it here makes it independent of the OS version's behaviour.
     */
    private fun applyWindowBars() {
        // The system bars take the shell's background, not the old navy top-bar colour:
        // everything above and below the content is now one flat #111111 surface, so a
        // tinted bar read as a leftover stripe.
        val barColor = ContextCompat.getColor(this, R.color.tk_bg)
        val window = this.window ?: return

        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
        window.statusBarColor = barColor
        window.navigationBarColor = barColor

        // These two are what actually decide icon contrast on API 23 / 26+. Without them
        // the system picks dark icons for a dark bar and the clock disappears.
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applyWindowBars()
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

        // No coins are granted here, and the client must not invent any.
        //
        // Buying a source code — or activating the all-access pass — is a Google Play MONEY
        // purchase. The coin economy in the Laravel spec only ever pays out for a verified
        // like/follow task, a coin-pack purchase, a spin, the welcome/referral bonus and the
        // daily reward; there is no server path that credits coins for a code purchase.
        //
        // This used to do `coinsBalance += 100`, which put 100 coins in the local cache that
        // the server had never granted (and then persisted them to KEY_COINS). The balance
        // therefore ran ahead of the real one, the affordability checks on Store and Tasks
        // used the inflated figure, and the next /me refresh silently reverted it. Same bug
        // class as the coin-pack path documented in SocialBoostApi.purchaseCoins.
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
        // A coin pack is not an order: there is nothing to deliver on the TikTok side, and the
        // balance must be credited by the server after it verifies the receipt. This used to
        // add 1,000 / 10,000 to the LOCAL balance only, so the coins disappeared on the next
        // refresh and the amounts did not even match the packs (17,000 / 50,000).
        if (productId == "tt_coin_19_99" || productId == "tt_coin_99_99") {
            creditCoinPack(productId, purchaseToken)
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
            // The balance chip is the most discoverable place to top up: tapping it opens the
            // coin packs. The balance is still refreshed, so the number is live when it opens.
            refreshCoinsFromServer(silent = true)
            showBuyCoinsDialog()
        }

        // The shell's top-left slot is the account's own picture now (it replaced the gold
        // "Upgrade" pill). Tapping it opens the Profile tab, where the balance, the orders
        // and the sign-out live.
        findViewById<View>(R.id.layout_top_avatar)?.setOnClickListener { selectTab(3) }

        // Profile screen: "Deposit" is this app's coin packs, and the premium banner leads
        // to the Store. Both point at flows that already exist rather than at new ones.
        findViewById<View>(R.id.btn_profile_deposit)?.setOnClickListener {
            refreshCoinsFromServer(silent = true)
            showBuyCoinsDialog()
        }
        findViewById<View>(R.id.card_profile_promo)?.setOnClickListener { selectTab(1) }
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
        val platform = Platforms.normalize(prefs.getString(Constants.KEY_PLATFORM, null))

        paintAvatar(handle, platform, cached)
        refreshProfileFromServer()
    }

    /**
     * Render one account's picture into both rings, falling back down the URL list.
     *
     * `platform` is required by the mirror URL: the server keys avatars by
     * (platform, username), so an unscoped request would hand back the other network's
     * picture for the same handle.
     */
    private fun paintAvatar(handle: String?, platform: String, avatarUrl: String?) {
        val urls = Avatars.candidates(handle, platform, avatarUrl)
        // Both rings show the same account: the large portrait on the Profile screen and
        // the small round one in the shell's top bar.
        listOf(R.id.iv_more_avatar, R.id.iv_top_avatar).forEach { id ->
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
        // The signed-in network. `/v6/me` keys its account lookup by (platform, username),
        // so omitting this asks for the TikTok row of an Instagram handle.
        val platform = Platforms.normalize(prefs.getString(Constants.KEY_PLATFORM, null))

        Thread {
            try {
                val profile = SocialBoostApi.fetchProfile(token, handle, secUid, platform)

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
                        runOnUiThread { paintAvatar(handle, platform, fallback) }
                    }
                    return@Thread
                }

                // Fill the profile card's stat row here rather than at the end: the row
                // does not depend on whether the avatar changed, and this function returns
                // early when it has not.
                runOnUiThread { paintProfileStats(profile) }

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
                    paintAvatar(resolvedHandle, platform, best)
                    profile.nickname?.let { tvGreeting.text = "Hello, $it 👋" }
                }
            } catch (e: Exception) {
                // Old server builds return no `tiktok_info` at all; the cached avatar stays.
                Log.d("HomeActivity", "profile refresh skipped: ${e.message}")
            }
        }.start()
    }

    /**
     * Following / Followers / Likes on the profile card.
     *
     * `profile.likes` is null when the network exposes no such figure — Instagram and
     * Facebook both report none, and the server sends an explicit null for them — so that
     * cell is left at the em dash the layout ships rather than overwritten with a
     * confident "0" that the user would read as a real count.
     */
    private fun paintProfileStats(profile: SocialBoostApi.ProfileInfo) {
        findViewById<TextView>(R.id.tv_more_following)?.text = profile.following.toString()
        findViewById<TextView>(R.id.tv_more_followers)?.text = profile.followers.toString()
        profile.likes?.let {
            findViewById<TextView>(R.id.tv_more_likes)?.text = it.toString()
        }
    }

    private fun updateCoinsDisplay() {
        tvCoins.text = "$coinsBalance"
        prefs.edit().putInt(Constants.KEY_COINS, coinsBalance).apply()

        // Keep the Store's affordability flags in step with the balance.
        if (::boostAdapter.isInitialized) boostAdapter.refreshAffordability()
        // The profile screen prints the figure and its unit separately: the number is the
        // large accent-coloured hero, "coins" is a small label beside it. So this is the
        // bare number, not "4765 coins".
        if (::tvMoreCoins.isInitialized) tvMoreCoins.text = coinsBalance.toString()
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
        val activeColor = ContextCompat.getColor(this, R.color.tk_cyan)
        val idleColor = ContextCompat.getColor(this, R.color.tk_nav_idle)

        // Icons are swapped, never tinted. The selected tab is the *filled* twin of its
        // glyph, and a ColorFilter would flatten that fill back into an outline — which is
        // exactly the cue the shell uses to mark the active tab.
        fun paintNav(active: Boolean, icon: ImageView, label: TextView, on: Int, off: Int) {
            icon.setImageResource(if (active) on else off)
            // The labels are kept for the bindings but hidden: the bar is icon-only.
            label.setTextColor(if (active) activeColor else idleColor)
            label.setTypeface(null, if (active) Typeface.BOLD else Typeface.NORMAL)
        }

        paintNav(index == 0, ivNavHome, tvNavHome,
            R.drawable.ic_tk_nav_tasks_on, R.drawable.ic_tk_nav_tasks)
        paintNav(index == 1, ivNavBoost, tvNavBoost,
            R.drawable.ic_tk_nav_store_on, R.drawable.ic_tk_nav_store)
        paintNav(index == 2, ivNavCodes, tvNavCodes,
            R.drawable.ic_tk_nav_codes_on, R.drawable.ic_tk_nav_codes)
        paintNav(index == 3, ivNavMore, tvNavMore,
            R.drawable.ic_tk_nav_more_on, R.drawable.ic_tk_nav_more)

        viewFlipper.displayedChild = index

        // Every tab names itself in the top bar now, so the wordmark it used to fall back
        // to is gone from the shell entirely.
        layoutTopWordmark?.visibility = View.GONE
        tvTopScreenTitle?.visibility = View.VISIBLE
        tvTopScreenTitle?.text = when (index) {
            1 -> getString(R.string.tt_nav_store)
            2 -> "Codes"
            3 -> getString(R.string.tt_nav_profile)
            else -> getString(R.string.nav_tasks)
        }

        // The top-left avatar is part of the shell chrome, so it stays on every tab. The
        // Upgrade pill it replaced only appeared on Tasks and pointed at the Store, which
        // the bottom navigation already does.

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
    /** The video's still on a like task; GONE on follow tasks. */
    private lateinit var ivTaskCover: ImageView
    /** Legibility scrim under the handle, shown only while the still is on screen. */
    private lateinit var viewTaskScrim: View
    private lateinit var btnTaskSkip: TextView
    private lateinit var btnTaskFollow: LinearLayout
    private lateinit var tvTaskFollowLabel: TextView
    private lateinit var tvTaskReward: TextView
    /** Follower count of the account being boosted, under the handle on the task card. */
    private lateinit var tvTaskTargetStats: TextView
    private lateinit var layoutTaskEmpty: LinearLayout
    private lateinit var tvTaskEmpty: TextView
    private lateinit var progressTaskLoading: android.widget.ProgressBar
    private lateinit var scrollTask: android.widget.ScrollView
    private lateinit var layoutTipsBody: LinearLayout
    private lateinit var btnTipsToggle: ImageView
    private lateinit var swipeTasks: androidx.swiperefreshlayout.widget.SwipeRefreshLayout

    /** "Your next task" heading: the one-line status and what the task pays. */
    private lateinit var tvTaskStatus: TextView
    private lateinit var layoutTaskStatusReward: View
    private lateinit var tvTaskStatusReward: TextView

    /** "Other tasks": the rest of the fetched page, listed but not tappable. */
    private lateinit var rvOtherTasks: RecyclerView
    private lateinit var otherTaskAdapter: QueuedTaskAdapter
    private lateinit var tvOtherTasksEmpty: TextView

    /** The queue of tasks returned by the feed, and the one currently on screen. */
    private val taskQueue = ArrayDeque<SocialBoostApi.TaskItem>()
    private var currentTask: SocialBoostApi.TaskItem? = null
    private var isVerifying = false
    private var pendingVerificationTask: SocialBoostApi.TaskItem? = null
    private var taskOpenedTimestamp: Long = 0L
    private var hasActionBeenOpened = false

    /**
     * Set when the last check came back "the provider is down, nothing was proven".
     *
     * The task is deliberately kept claimable in that case — the user did the action, we
     * simply could not read their account — but a *resume* must not silently re-run the
     * check, or every trip away from the app would fire another doomed request and another
     * toast. With this set, [handleTaskReturnOnResume] goes quiet and the user retries
     * deliberately by tapping the button, which is the only thing that should cost a
     * round-trip while the platform is unavailable.
     */
    private var pendingCheckRetry = false

    /**
     * How long a remembered action stays claimable.
     *
     * Long enough to cover "follow, get distracted, come back"; short enough that a record
     * left over from another day is never re-checked, which would nag the user with a toast
     * about a task they have long since moved past.
     */
    private val pendingVerifyTtlMs = 15 * 60 * 1000L

    /**
     * Remember — across a process restart — that we just sent the user off to perform this
     * task's action.
     *
     * [pendingVerificationTask] alone is not enough. Completing a follow means leaving for
     * Instagram or TikTok, and that is exactly when a small handset evicts this process. The
     * user used to return to a *new* Activity with nothing pending: the feed simply reloaded,
     * the task still looked undone, [handleTaskReturnOnResume] returned early on a null task,
     * and the coins for an action they had genuinely performed were never claimed — with
     * nothing on screen to explain why.
     *
     * Only what verification needs is stored. Every judgement happens server-side against the
     * viewer's live counters, so remembering the order id is enough to settle the reward.
     */
    private fun rememberPendingVerification(task: SocialBoostApi.TaskItem) {
        prefs.edit()
            .putInt(Constants.KEY_PENDING_VERIFY_ORDER_ID, task.orderId)
            .putString(Constants.KEY_PENDING_VERIFY_USERNAME, task.username)
            .putBoolean(Constants.KEY_PENDING_VERIFY_IS_LIKES, task.isLikes)
            .putString(Constants.KEY_PENDING_VERIFY_PLATFORM, Platforms.normalize(task.platform))
            .putString(Constants.KEY_PENDING_VERIFY_ACTION, task.actionType)
            .putInt(Constants.KEY_PENDING_VERIFY_REWARD, task.rewardCoins)
            .putLong(Constants.KEY_PENDING_VERIFY_OPENED_AT, taskOpenedTimestamp)
            .apply()
    }

    /** Drop the remembered action: it has been claimed, skipped, or has gone stale. */
    private fun forgetPendingVerification() {
        prefs.edit()
            .remove(Constants.KEY_PENDING_VERIFY_ORDER_ID)
            .remove(Constants.KEY_PENDING_VERIFY_USERNAME)
            .remove(Constants.KEY_PENDING_VERIFY_IS_LIKES)
            .remove(Constants.KEY_PENDING_VERIFY_PLATFORM)
            .remove(Constants.KEY_PENDING_VERIFY_ACTION)
            .remove(Constants.KEY_PENDING_VERIFY_REWARD)
            .remove(Constants.KEY_PENDING_VERIFY_OPENED_AT)
            .apply()
    }

    /**
     * Rebuild [pendingVerificationTask] after the Activity was recreated.
     *
     * A no-op when something is already pending, so the ordinary in-process path is
     * untouched. A record older than [pendingVerifyTtlMs] is treated as a leftover and
     * discarded rather than re-checked.
     */
    private fun restorePendingVerification() {
        if (pendingVerificationTask != null) return

        val orderId = prefs.getInt(Constants.KEY_PENDING_VERIFY_ORDER_ID, 0)
        val openedAt = prefs.getLong(Constants.KEY_PENDING_VERIFY_OPENED_AT, 0L)
        val username = prefs.getString(Constants.KEY_PENDING_VERIFY_USERNAME, null)

        if (orderId == 0 || openedAt <= 0L || username.isNullOrBlank() ||
            System.currentTimeMillis() - openedAt > pendingVerifyTtlMs
        ) {
            forgetPendingVerification()
            return
        }

        pendingVerificationTask = SocialBoostApi.TaskItem(
            orderId = orderId,
            username = username,
            // Only ever used to paint a card; verification does not read these.
            imageUrl = "",
            isLikes = prefs.getBoolean(Constants.KEY_PENDING_VERIFY_IS_LIKES, false),
            rewardCoins = prefs.getInt(Constants.KEY_PENDING_VERIFY_REWARD, 0),
            url = "",
            postPk = null,
            platform = prefs.getString(
                Constants.KEY_PENDING_VERIFY_PLATFORM,
                Platforms.DEFAULT
            ) ?: Platforms.DEFAULT,
            actionType = prefs.getString(Constants.KEY_PENDING_VERIFY_ACTION, null)
        )
        taskOpenedTimestamp = openedAt
        hasActionBeenOpened = true
    }

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
        ivTaskCover = findViewById(R.id.iv_task_cover)
        viewTaskScrim = findViewById(R.id.view_task_scrim)
        btnTaskSkip = findViewById(R.id.btn_task_skip)
        btnTaskFollow = findViewById(R.id.btn_task_follow)
        tvTaskFollowLabel = findViewById(R.id.tv_task_follow_label)
        tvTaskReward = findViewById(R.id.tv_task_reward)
        tvTaskTargetStats = findViewById(R.id.tv_task_target_stats)
        layoutTaskEmpty = findViewById(R.id.layout_task_empty)
        tvTaskEmpty = findViewById(R.id.tv_task_empty)
        progressTaskLoading = findViewById(R.id.progress_task_loading)
        scrollTask = findViewById(R.id.scroll_task)
        layoutTipsBody = findViewById(R.id.layout_tips_body)
        btnTipsToggle = findViewById(R.id.btn_tips_toggle)
        swipeTasks = findViewById(R.id.swipe_tasks)

        tvTaskStatus = findViewById(R.id.tv_task_status)
        layoutTaskStatusReward = findViewById(R.id.layout_task_status_reward)
        tvTaskStatusReward = findViewById(R.id.tv_task_status_reward)

        // "Other tasks" — the rest of the page the feed returned. Its own backing list
        // rather than reading `taskQueue` directly: the card pops from that queue as tasks
        // advance, and pointing an adapter at the same deque is how you get a RecyclerView
        // reading a mutated collection mid-layout.
        otherTaskAdapter = QueuedTaskAdapter(mutableListOf())
        rvOtherTasks = findViewById(R.id.rv_other_tasks)
        rvOtherTasks.layoutManager = LinearLayoutManager(this)
        rvOtherTasks.adapter = otherTaskAdapter
        tvOtherTasksEmpty = findViewById(R.id.tv_other_tasks_empty)

        // Same framework trap as the order screen: RecyclerView turns itself focusable in
        // its constructor, after XML attributes are applied, so android:focusable="false"
        // in the layout has no effect. A focusable child taller than the viewport makes the
        // parent ScrollView pull its bottom into view, which would open this screen
        // scrolled past the live task card.
        rvOtherTasks.isFocusable = false
        rvOtherTasks.isFocusableInTouchMode = false

        // The reference app puts a help link under the "Other tasks" heading. It opens the
        // step-by-step dialog the More screen already uses rather than a second copy of it.
        findViewById<View>(R.id.btn_how_to_perform).setOnClickListener {
            showHowItWorksDialog()
        }

        // "Pull to retry" has to actually retry. The empty state used to tell the
        // user to pull while nothing listened for the gesture, so a failed or
        // exhausted feed was a dead end until the app was restarted.
        swipeTasks.setColorSchemeColors(getColor(R.color.tt_accent), getColor(R.color.tt_blue))
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
        // The confirmation must name what the buyer actually paid for. `isLikes` only says
        // "anchored to a post", which is now also true of shares, comments and views.
        val orderType = OrderType.fromProductType(typeLabel)
        val what = if (orderType?.needsVideoTarget ?: isLikes) "video" else "profile"
        val action = when (orderType) {
            OrderType.LIKES -> "like"
            OrderType.SHARES -> "share"
            OrderType.COMMENTS -> "comment"
            OrderType.VIEWS -> "view"
            OrderType.FOLLOWERS -> "follow"
            null -> if (isLikes) "like" else "follow"
        }

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

    /** The resolved post behind [selectedVideoUrl], once the server has confirmed it. */
    private var selectedVideoPreview: SocialBoostApi.PostPreview? = null

    /**
     * Guards against a slow resolution overwriting a newer one.
     *
     * Pasting twice in a row used to be able to land the first answer last, so the card
     * showed video A while the field and the order held video B.
     */
    private var orderLinkRequest = 0

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

        makeBoostListsNonFocusable()

        updateBoostTargetAccountInfo()
        setupOrderTabs()
        setupOrderTargetPicker()
        // The reference opens the Store on Profile, so this does too: the buyer meets the
        // follower packs — the thing most of them came for — without touching a tab.
        selectOrderType(OrderType.FOLLOWERS)

        setupCoinPackButtons()
        loadBoostProducts()
    }

    /**
     * Stop the three lists on the New order screen from taking focus.
     *
     * `RecyclerView` calls `setFocusableInTouchMode(true)` in its constructor — *after* the
     * XML attributes have been applied — so `android:focusable="false"` in the layout has
     * no effect. That was harmless while the package list owned its own scroll area, but
     * the screen is now a single `NestedScrollView`: a focusable child taller than the
     * viewport makes the scroll view pull the child's **bottom** into view, so the screen
     * opened scrolled past the tab bar.
     *
     * Turning focus off costs nothing here — touch scrolling and item clicks do not need it.
     */
    private fun makeBoostListsNonFocusable() {
        for (id in intArrayOf(R.id.rv_boost_products, R.id.rv_order_videos)) {
            findViewById<View>(id)?.let {
                it.isFocusable = false
                it.isFocusableInTouchMode = false
            }
        }
    }

    /**
     * The Profile / Video segmented bar at the top of the Store, and the action chips
     * inside the Video tab.
     *
     * Two tabs, not five. The Store sells two *places* — followers for the account, an
     * action on one post — and the reference app shows exactly that. The five-tile grid
     * this replaced exposed every action as a top-level destination, which reads as a
     * taxonomy rather than a shop.
     *
     * The action itself is a chip inside the Video tab. That distinction matters: nothing
     * in this screen ever called [selectOrderType] with anything except FOLLOWERS and
     * LIKES, so three of the five product families the server actually sells — Views,
     * Shares and Comments, all priced, active and deliverable — could not be bought at
     * all. The adapter could already filter by them; no control ever asked.
     */
    private fun setupOrderTabs() {
        findViewById<View>(R.id.tab_store_profile)
            ?.setOnClickListener { selectOrderType(OrderType.FOLLOWERS) }
        findViewById<View>(R.id.tab_store_video)
            ?.setOnClickListener {
                // Re-entering the Video tab restores the action that was last chosen
                // there, so hopping to Profile and back does not silently turn a Views
                // order into a Likes one.
                selectOrderType(
                    selectedOrderType.takeIf { it.needsVideoTarget } ?: OrderType.LIKES
                )
            }

        for ((id, type) in postActionChips) {
            findViewById<View>(id)?.setOnClickListener {
                if (!actionMeasurable(type)) {
                    // The video's network does not report this counter, so the server could
                    // never verify the task. Explain that here, at the tap — the alternative
                    // is a package list the buyer pays from and then loses.
                    Toast.makeText(
                        this,
                        getString(R.string.tt_order_action_unsupported, type.label),
                        Toast.LENGTH_LONG,
                    ).show()
                    return@setOnClickListener
                }
                selectOrderType(type)
            }
        }

        paintStoreTabs()
    }

    /**
     * Can this action be verified on the video that is currently selected?
     *
     * The preview reports which counters the provider actually returned (`orderable`: a
     * TikTok post always has a play count, an Instagram post has no share count at all).
     * With no video chosen yet every action stays available — the picker comes first, and
     * greying chips before there is anything to check would just look broken.
     */
    private fun actionMeasurable(type: OrderType): Boolean {
        val preview = selectedVideoPreview ?: return true
        return preview.orderable.contains(type.actionKey)
    }

    /**
     * The post-anchored actions, in the order the chips appear.
     *
     * Followers is deliberately absent: it targets the profile, not a post, so it belongs
     * to the Profile tab and has no chip.
     */
    private val postActionChips: List<Pair<Int, OrderType>> = listOf(
        R.id.chip_action_likes to OrderType.LIKES,
        R.id.chip_action_views to OrderType.VIEWS,
        R.id.chip_action_shares to OrderType.SHARES,
        R.id.chip_action_comments to OrderType.COMMENTS,
    )

    /** Mark the tab that owns the current [selectedOrderType], and only that one. */
    private fun paintStoreTabs() {
        // Every post-anchored action lives behind the Video tab, not just Likes. Testing
        // `== LIKES` left the Profile tab lit while a Views package was on screen.
        val videoSelected = selectedOrderType.needsVideoTarget
        val on = ContextCompat.getColor(this, R.color.white)
        val off = ContextCompat.getColor(this, R.color.tt_text_secondary)

        // Both halves carry a label and a weight, so the selected one is bold *and* the
        // idle one is explicitly normal — otherwise tapping back would leave two bolds.
        findViewById<TextView>(R.id.tv_store_tab_profile)?.let { label ->
            label.setTextColor(if (videoSelected) off else on)
            label.setTypeface(null, if (videoSelected) Typeface.NORMAL else Typeface.BOLD)
        }
        findViewById<TextView>(R.id.tv_store_tab_video)?.let { label ->
            label.setTextColor(if (videoSelected) on else off)
            label.setTypeface(null, if (videoSelected) Typeface.BOLD else Typeface.NORMAL)
        }

        findViewById<View>(R.id.ind_store_profile)?.visibility =
            if (videoSelected) View.INVISIBLE else View.VISIBLE
        findViewById<View>(R.id.ind_store_video)?.visibility =
            if (videoSelected) View.VISIBLE else View.INVISIBLE

        paintActionChips()
    }

    /**
     * Light the chip for the action being ordered, and dim the ones this video cannot support.
     *
     * The border, the wash and the label colour all come from state-selected drawables, so
     * selection only flips `isSelected` — the same contract [item_order_type_tile] uses.
     */
    private fun paintActionChips() {
        for ((id, type) in postActionChips) {
            val chip = findViewById<TextView>(id) ?: continue
            chip.isSelected = type == selectedOrderType
            chip.alpha = if (actionMeasurable(type)) 1f else 0.35f
        }
        updateActionHint()
    }

    /**
     * One line under the chips: what the action actually means, and what it costs from.
     *
     * The chips name an action but cannot explain it, and "order 100 views" is meaningless to
     * someone who has never seen a view land — the task is refused when the counter does not
     * move, and for views TikTok publishes that counter with a lag. Saying so before payment
     * is the difference between a failed verification and an expected one.
     */
    private fun updateActionHint() {
        val hint = findViewById<TextView>(R.id.tv_order_action_hint) ?: return
        val type = selectedOrderType
        if (!type.needsVideoTarget) {
            hint.visibility = View.GONE
            return
        }
        hint.visibility = View.VISIBLE

        val what = getString(
            when (type) {
                OrderType.VIEWS -> R.string.tt_order_action_what_views
                OrderType.SHARES -> R.string.tt_order_action_what_shares
                OrderType.COMMENTS -> R.string.tt_order_action_what_comments
                else -> R.string.tt_order_action_what_likes
            }
        )

        // Cheapest tier of this family in each currency. Views, Shares and Comments used to
        // be coin-only, so a single "cheapest" lookup was enough; now that they also have
        // card packs, quoting only the coin price would tell someone with no coins the one
        // thing they cannot do, and quoting only the card price would hide the free route.
        val family = serverProducts.filter { OrderType.fromProductType(it.productType) == type }
        val cheapestCoin = family.filter { it.isCoinProduct }.minByOrNull { it.actionCount }
        val cheapestCash = family.filter { !it.isCoinProduct }.minByOrNull { it.actionCount }

        val price = when {
            cheapestCoin == null && cheapestCash == null -> ""
            cheapestCoin == null ->
                getString(R.string.tt_order_action_from_cash, cheapestCash?.price ?: "")
            cheapestCash == null -> {
                val coins = cheapestCoin!!.coinsPrice ?: 0
                val coinText = NumberFormat.getIntegerInstance().format(coins)
                // Views, Shares and Comments have no card price anywhere, so without the
                // money equivalent the hint is the only number on screen that cannot be
                // placed against the "$2.99" on the Likes tab.
                val usd = BoostAdapter.usdForCoins(serverProducts, coins)
                if (usd == null) {
                    getString(R.string.tt_order_action_from_coins, coinText)
                } else {
                    getString(R.string.tt_order_action_from_coins_usd, coinText, usd)
                }
            }
            else -> {
                val coins = cheapestCoin!!.coinsPrice ?: 0
                getString(
                    R.string.tt_order_action_from_both,
                    NumberFormat.getIntegerInstance().format(coins),
                    BoostAdapter.usdForCoins(serverProducts, coins) ?: "—",
                    cheapestCash?.price ?: "",
                )
            }
        }
        hint.text = what + price
    }

    /**
     * Switch the Store to an order type.
     *
     * All five types are reachable: Followers from the Profile tab, and Likes / Views /
     * Shares / Comments from the chips inside the Video tab. The unavailable branch stays
     * because a type the backend cannot deliver must explain itself rather than silently
     * show nothing.
     *
     * Followers are added to the buyer's own profile, so that tab hides the link field and
     * shows where the followers land instead. Every other type is anchored to one post, so
     * those reveal the link field and the account's own videos.
     */
    private fun selectOrderType(type: OrderType) {
        selectedOrderType = type
        paintStoreTabs()

        val targetPicker = findViewById<View>(R.id.card_video_target_selection)
        val profileNote = findViewById<TextView>(R.id.tv_profile_target_note)
        val unavailable = findViewById<TextView>(R.id.tv_order_type_unavailable)
        val products = findViewById<View>(R.id.rv_boost_products)

        if (!type.available) {
            targetPicker?.visibility = View.GONE
            profileNote?.visibility = View.GONE
            products?.visibility = View.GONE
            unavailable?.visibility = View.VISIBLE
            unavailable?.text = getString(R.string.tt_order_type_unavailable_body, type.label)
            Toast.makeText(
                this,
                getString(R.string.tt_order_type_unavailable_title, type.label),
                Toast.LENGTH_SHORT
            ).show()
            return
        }

        unavailable?.visibility = View.GONE
        products?.visibility = View.VISIBLE

        if (type.needsVideoTarget) {
            targetPicker?.visibility = View.VISIBLE
            profileNote?.visibility = View.GONE
            updateSelectedVideoBanner()
            loadOrderVideos()
        } else {
            targetPicker?.visibility = View.GONE
            profileNote?.visibility = View.VISIBLE
            profileNote?.text = getString(
                R.string.tt_new_order_profile_target,
                prefs.getString(Constants.KEY_TIKTOK_USERNAME, null) ?: "you"
            )
        }

        // Show the packages for the type actually selected. The old binary tab could only
        // express "likes" vs "followers", so Shares/Comments/Views displayed Followers
        // packages — and buying one would have charged for the wrong product.
        boostAdapter.setSelectedType(type.label)
        boostAdapter.refreshAffordability()
        refreshBoostPackageState()
    }

    /**
     * Keep the package list and its empty label in agreement with the current type.
     *
     * The adapter will not borrow another action's catalogue (a Views heading over Likes
     * prices is how a buyer pays for the wrong thing), so "no rows" is a state that has to
     * be *said* rather than papered over. It is also the honest state while the catalogue
     * is still in flight — hence the loading wording when nothing has arrived yet.
     */
    private fun refreshBoostPackageState() {
        val empty = findViewById<TextView>(R.id.tv_boost_empty) ?: return
        val list = findViewById<View>(R.id.rv_boost_products)

        // Tier count, not item count: the list now carries pricing-section headers, so a family
        // with rows still reports a couple of items and a family with none reports zero only
        // if its headers were skipped too.
        if (boostAdapter.tierCount == 0) {
            empty.text = if (serverProducts.isEmpty()) {
                getString(R.string.tt_boost_loading)
            } else {
                getString(R.string.tt_boost_empty_for_type, selectedOrderType.label)
            }
            empty.visibility = View.VISIBLE
            list?.visibility = View.GONE
        } else {
            empty.visibility = View.GONE
            list?.visibility = View.VISIBLE
        }
    }

    /** The link field, its paste button, and the "How to find a link?" help. */
    private fun setupOrderTargetPicker() {
        val input = findViewById<EditText>(R.id.et_order_link)
        val error = findViewById<TextView>(R.id.tv_order_link_error)

        // Pasting is the primary path in the reference app, so the button reads the
        // clipboard, fills the field and validates in one step.
        findViewById<View>(R.id.btn_paste_order_link)?.setOnClickListener {
            val clip = (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
            val text = clip?.getItemAt(0)?.coerceToText(this)?.toString().orEmpty().trim()
            if (text.isBlank()) {
                error?.text = getString(R.string.tt_add_video_empty)
                error?.visibility = View.VISIBLE
                return@setOnClickListener
            }
            input?.setText(text)
            input?.setSelection(text.length)
            commitOrderLink()
        }

        // The full-screen "Choose a Video" grid, as in the reference. It was written but
        // never reachable: the only two call sites pointed at each other.
        findViewById<View>(R.id.btn_choose_video)?.setOnClickListener {
            showChooseVideoDialog()
        }

        input?.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                commitOrderLink()
                true
            } else {
                false
            }
        }

        input?.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                if (error?.visibility == View.VISIBLE) error.visibility = View.GONE
            }
        })

        findViewById<View>(R.id.tv_how_to_find_link)?.setOnClickListener {
            showHowToFindLinkDialog()
        }

        // The card's two affordances. "Change" keeps the link in place and selects it, so
        // the user edits what is there instead of retyping it; the X removes the target
        // entirely, because an order must never be placed against a video the buyer has
        // just dismissed.
        findViewById<View>(R.id.btn_selected_change)?.setOnClickListener {
            input?.requestFocus()
            val text = input?.text?.length ?: 0
            input?.setSelection(0, text)
        }

        findViewById<View>(R.id.btn_selected_clear)?.setOnClickListener {
            clearSelectedVideoTarget()
            input?.setText("")
            error?.visibility = View.GONE
        }
    }

    /**
     * Validate whatever is in the link field and adopt it as the order target.
     *
     * @return true when the field now holds a usable link.
     */
    private fun commitOrderLink(): Boolean {
        val input = findViewById<EditText>(R.id.et_order_link) ?: return false
        val error = findViewById<TextView>(R.id.tv_order_link_error)
        val raw = input.text.toString().trim()

        if (raw.isBlank()) {
            error?.text = getString(R.string.tt_add_video_empty)
            error?.visibility = View.VISIBLE
            return false
        }

        // The link has to belong to the network the user signed in with — a TikTok URL on
        // an Instagram account produces an order the server cannot read.
        val parsed = normalizeVideoLink(raw)
        if (parsed == null) {
            error?.text = getString(
                when (Platforms.normalize(prefs.getString(Constants.KEY_PLATFORM, null))) {
                    Platforms.INSTAGRAM -> R.string.tt_add_post_bad_link_instagram
                    Platforms.FACEBOOK -> R.string.tt_add_post_bad_link_facebook
                    else -> R.string.tt_add_video_bad_link
                }
            )
            error?.visibility = View.VISIBLE
            return false
        }

        error?.visibility = View.GONE
        applySelectedVideo(parsed.first, parsed.second, "Video ${parsed.first.ifBlank { "link" }}")
        return true
    }

    /** "How to find a link?" — concrete, per network. */
    private fun showHowToFindLinkDialog() {
        val body = when (Platforms.normalize(prefs.getString(Constants.KEY_PLATFORM, null))) {
            Platforms.INSTAGRAM ->
                "1. Open the post in Instagram.\n2. Tap the ⋯ button at the top right.\n3. Tap Copy link.\n4. Come back and paste it above."
            Platforms.FACEBOOK ->
                "1. Open the post in Facebook.\n2. Tap the ⋯ button under it.\n3. Tap Copy link.\n4. Come back and paste it above."
            else ->
                "1. Open the video in TikTok.\n2. Tap Share (the arrow).\n3. Tap Copy link.\n4. Come back and paste it above."
        }
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.tt_new_order_how_to_find).replace("\n", " "))
            .setMessage(body)
            .setPositiveButton(R.string.tt_done, null)
            .show()
    }

    /**
     * Fill the horizontal video strip with the account's own posts.
     *
     * Only TikTok can list a user's posts; for the other networks the server answers with
     * an empty page on purpose. That is why the strip says so rather than silently showing
     * nothing — the paste field is the way in, and the user should know that.
     *
     * Fetched once per handle: the list does not depend on the order type, so re-entering
     * the Likes tile should not re-hit the provider.
     */
    private fun loadOrderVideos() {
        val rv = findViewById<RecyclerView>(R.id.rv_order_videos) ?: return
        val progress = findViewById<View>(R.id.progress_order_videos)
        val empty = findViewById<TextView>(R.id.tv_order_videos_empty)
        val title = findViewById<View>(R.id.tv_order_videos_title)

        rv.layoutManager = LinearLayoutManager(this, RecyclerView.HORIZONTAL, false)
        rv.isNestedScrollingEnabled = false

        if (orderVideoAdapter == null) {
            orderVideoAdapter = object : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
                override fun getItemCount(): Int = orderVideos.size

                override fun onCreateViewHolder(
                    parent: ViewGroup,
                    viewType: Int
                ): RecyclerView.ViewHolder {
                    val v = LayoutInflater.from(parent.context)
                        .inflate(R.layout.item_video_thumb, parent, false)
                    return object : RecyclerView.ViewHolder(v) {}
                }

                override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
                    val item = orderVideos[position]
                    val thumb = holder.itemView.findViewById<ImageView>(R.id.iv_order_video_thumb)
                    holder.itemView.findViewById<TextView>(R.id.tv_order_video_likes).text = item.likes

                    if (item.thumbUrl.isNotBlank()) {
                        Glide.with(this@HomeActivity)
                            .load(item.thumbUrl)
                            .placeholder(R.drawable.bg_gradient_dark)
                            .into(thumb)
                    } else {
                        thumb.setImageResource(R.drawable.bg_gradient_dark)
                    }

                    holder.itemView.setOnClickListener {
                        applySelectedVideo(item.id, item.url, "${item.title} (${item.likes} ❤️)")
                    }
                }
            }
            rv.adapter = orderVideoAdapter
        }

        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null)
        val handle = prefs.getString(Constants.KEY_TIKTOK_USERNAME, null)

        if (token.isNullOrBlank() || handle.isNullOrBlank()) {
            orderVideos.clear()
            orderVideoAdapter?.notifyDataSetChanged()
            title?.visibility = View.GONE
            empty?.visibility = View.GONE
            return
        }

        // Cached per handle, and an empty result still counts as cached: on Instagram and
        // Facebook the server answers with an empty page *by design*, so the old
        // `&& orderVideos.isNotEmpty()` guard never latched for those platforms and every
        // single visit to the Videos tab fired another round-trip.
        if (orderVideosFetchedFor == handle) return

        title?.visibility = View.VISIBLE
        progress?.visibility = View.VISIBLE
        empty?.visibility = View.GONE

        Thread {
            var reachedServer = true
            val posts = try {
                SocialBoostApi.fetchPosts(
                    token,
                    handle,
                    platform = Platforms.normalize(prefs.getString(Constants.KEY_PLATFORM, null)),
                )
            } catch (e: Exception) {
                Log.w("HomeActivity", "order video strip failed: ${e.message}")
                reachedServer = false
                emptyList()
            }
            runOnUiThread {
                progress?.visibility = View.GONE
                orderVideos.clear()
                orderVideos.addAll(
                    posts.map {
                        TikTokVideoSample(it.id, it.title, it.thumbUrl, it.likes, it.comments, it.url)
                    }
                )
                orderVideoAdapter?.notifyDataSetChanged()
                // A failed call must not be remembered as "this account has no videos",
                // or one provider outage would hide the strip until the next login.
                if (reachedServer) orderVideosFetchedFor = handle
                empty?.visibility = if (orderVideos.isEmpty()) View.VISIBLE else View.GONE
            }
        }.start()
    }

    /** Keep the link field showing whichever target is currently selected. */
    private fun updateSelectedVideoBanner() {
        val input = findViewById<EditText>(R.id.et_order_link) ?: return
        val target = selectedVideoUrl
        if (!target.isNullOrBlank() && input.text.toString().trim() != target) {
            input.setText(target)
            input.setSelection(target.length)
        }
    }

    /** Point the user at the target picker when a post-scoped order has no post yet. */
    private fun promptForOrderTarget() {
        // A link that is already in the field but could not be read is a different problem
        // from an empty field, and the answer is already printed under the field. Stacking
        // a "pick a video" dialog on top of that explanation just buries it.
        val input = findViewById<EditText>(R.id.et_order_link)
        val error = findViewById<TextView>(R.id.tv_order_link_error)
        if (!input?.text.isNullOrBlank() && error?.visibility == View.VISIBLE) {
            Toast.makeText(this, error?.text, Toast.LENGTH_LONG).show()
            input?.requestFocus()
            return
        }

        Toast.makeText(
            this,
            getString(R.string.tt_new_order_pick_video_first, selectedOrderType.label),
            Toast.LENGTH_LONG
        ).show()

        // Two ways in, and the picker is one of them. Focusing the paste field alone made
        // "buy a like" look broken for anyone who had never pasted a link: the field sits
        // below the fold on the Video tab, so the toast was the only thing they saw.
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.tt_new_order_target_title))
            .setItems(
                arrayOf(
                    getString(R.string.tt_choose_video_from_list),
                    getString(R.string.tt_choose_video_paste)
                )
            ) { _, which ->
                if (which == 0) {
                    showChooseVideoDialog()
                } else {
                    findViewById<EditText>(R.id.et_order_link)?.requestFocus()
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
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
                    // Only TikTok can list an account's posts. For the other networks the
                    // server answers with an empty page, so the picker shows the paste-link
                    // tile — which is why the platform has to travel with the request.
                    SocialBoostApi.fetchPosts(
                        token,
                        handle,
                        platform = Platforms.normalize(prefs.getString(Constants.KEY_PLATFORM, null)),
                    )
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

        // Keep the link field in agreement with the card. Three different paths land here —
        // the paste field, the "Your videos" strip and the full-screen add-link dialog — and
        // the last two used to leave the field empty, so a chosen video sat next to a blank
        // box that looked like nothing had been picked.
        findViewById<EditText>(R.id.et_order_link)?.let { field ->
            if (field.text?.toString()?.trim() != url) {
                field.setText(url)
                field.setSelection(url.length)
            }
        }

        // Resolve it and show the video. The old version stopped at a toast, so the only
        // evidence the buyer had that anything had happened was the link sitting in the
        // box — and the first real confirmation came much later, as "Could not read that
        // video" from the server.
        resolveOrderLink(url)
    }

    /** Show or hide the little spinner that sits where the video card will appear. */
    private fun setOrderLinkBusy(busy: Boolean) {
        findViewById<View>(R.id.progress_order_link)?.visibility =
            if (busy) View.VISIBLE else View.GONE
    }

    /**
     * Forget the chosen video.
     *
     * Deliberately clears the *target*, not just the card: a buyer who removes a video must
     * not have the order silently fall back to the previous one.
     */
    private fun clearSelectedVideoTarget() {
        selectedVideoPreview = null
        selectedVideoPostPk = null
        selectedVideoUrl = null
        selectedVideoTitleStr = null
        findViewById<View>(R.id.card_selected_video)?.visibility = View.GONE
        setOrderLinkBusy(false)
        // With no video chosen there is nothing that can be unmeasurable, so every chip
        // comes back to full strength.
        paintActionChips()
    }

    /**
     * Ask the server what this link actually points at, then draw it.
     *
     * The local regex only proves the text *looks* like a post link. Turning it into a
     * video needs the provider: a `vm.tiktok.com` short link has no id until its redirect
     * is followed, and only the provider knows the cover and the counters. What comes back
     * replaces the local guess, so the order is placed against the canonical post id.
     *
     * A failure is not fatal — the order's URL stays in the field and the server reads the
     * post again when the order is created — but the *target* is cleared, because ordering
     * the previously selected video while the field shows a different link would be the
     * worst of both worlds.
     */
    private fun resolveOrderLink(url: String) {
        val error = findViewById<TextView>(R.id.tv_order_link_error)
        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null)
        val platform = Platforms.normalize(prefs.getString(Constants.KEY_PLATFORM, null))

        error?.visibility = View.GONE
        // Hide the previous card, but keep the URL: applySelectedVideo has already pointed
        // the target at the link the user just pasted, so an order placed during the (brief)
        // resolution still refers to the right video. Only a failure clears it.
        selectedVideoPreview = null
        findViewById<View>(R.id.card_selected_video)?.visibility = View.GONE
        setOrderLinkBusy(true)
        // Nothing is known about the new link yet, so every action is offered again until
        // the preview comes back and says which counters this video actually has.
        paintActionChips()

        // Signed out: there is nothing to resolve against. The link is still accepted by
        // the order path, which will fail with its own message if the server cannot read it.
        if (token.isNullOrBlank()) {
            setOrderLinkBusy(false)
            return
        }

        val request = ++orderLinkRequest
        Thread {
            try {
                val preview = SocialBoostApi.previewPost(token, url, platform)
                runOnUiThread {
                    if (request != orderLinkRequest || isFinishing || isDestroyed) return@runOnUiThread
                    bindSelectedVideo(preview)
                }
            } catch (e: Exception) {
                Log.w("HomeActivity", "post preview failed: ${e.message}")
                runOnUiThread {
                    if (request != orderLinkRequest || isFinishing || isDestroyed) return@runOnUiThread
                    clearSelectedVideoTarget()
                    error?.text = e.message ?: getString(R.string.tt_add_video_bad_link)
                    error?.visibility = View.VISIBLE
                }
            }
        }.start()
    }

    /** Draw the resolved video: cover, whose it is, and what it can be ordered for. */
    private fun bindSelectedVideo(preview: SocialBoostApi.PostPreview) {
        selectedVideoPreview = preview
        selectedVideoPostPk = preview.postPk
        selectedVideoUrl = preview.url
        selectedVideoTitleStr = preview.nickname ?: preview.author
        updateSelectedVideoBanner()
        setOrderLinkBusy(false)

        findViewById<TextView>(R.id.tv_order_link_error)?.visibility = View.GONE

        val card = findViewById<View>(R.id.card_selected_video) ?: return
        val author = findViewById<TextView>(R.id.tv_selected_author)
        val stats = findViewById<TextView>(R.id.tv_selected_stats)
        val desc = findViewById<TextView>(R.id.tv_selected_desc)
        val cover = findViewById<ImageView>(R.id.iv_selected_cover)

        author?.text = when {
            !preview.author.isNullOrBlank() -> "@${preview.author}"
            !preview.nickname.isNullOrBlank() -> preview.nickname
            else -> getString(R.string.tt_order_video_section)
        }

        // Only counters the provider actually returned. Each one is what the order will be
        // verified against, so showing a figure here is a promise the task can be measured.
        val parts = mutableListOf<String>()
        preview.likeCount?.let { parts.add(getString(R.string.tt_order_video_likes, compactCount(it))) }
        preview.commentCount?.let {
            parts.add(getString(R.string.tt_order_video_comments, compactCount(it)))
        }
        preview.viewCount?.let { parts.add(getString(R.string.tt_order_video_views, compactCount(it))) }
        stats?.text = parts.joinToString(" · ")
        stats?.visibility = if (parts.isEmpty()) View.GONE else View.VISIBLE

        if (preview.desc.isNullOrBlank()) {
            desc?.visibility = View.GONE
        } else {
            desc?.text = preview.desc
            desc?.visibility = View.VISIBLE
        }

        if (preview.cover.isNullOrBlank()) {
            cover?.setImageResource(R.drawable.bg_gradient_dark)
        } else {
            Glide.with(this)
                .load(preview.cover)
                .placeholder(R.drawable.bg_gradient_dark)
                .into(cover)
        }

        // The eye badge doubles as "this video can be ordered for views", which is exactly
        // the question a buyer on the Views package is asking.
        findViewById<View>(R.id.iv_selected_play)?.visibility =
            if (preview.viewCount != null) View.VISIBLE else View.GONE

        card.visibility = View.VISIBLE

        // The video now decides which actions exist: dim the ones it cannot support, and move
        // off one that has just become impossible. Painting happens after the fallback switch
        // so the chips and the package list can never disagree.
        ensureMeasurableActionSelected()
        paintActionChips()
    }

    /**
     * If the video that just resolved cannot support the action already chosen, move to one it can.
     *
     * The usual case: Views is selected and someone pastes an Instagram post, whose provider
     * exposes no play count. Switching (and saying so) beats leaving a lit chip that refuses
     * every tap, and beats letting the order through as unverifiable.
     */
    private fun ensureMeasurableActionSelected() {
        if (actionMeasurable(selectedOrderType)) return
        val fallback = postActionChips.map { it.second }.firstOrNull { actionMeasurable(it) } ?: return
        Toast.makeText(
            this,
            getString(
                R.string.tt_order_action_switched,
                selectedOrderType.label,
                fallback.label
            ),
            Toast.LENGTH_LONG
        ).show()
        selectOrderType(fallback)
    }

    /** 133100 -> "133.1k", 9300 -> "9.3k", 332 -> "332". */
    private fun compactCount(n: Int): String = when {
        n >= 1_000_000 -> String.format("%.1fm", n / 1_000_000.0)
        n >= 1_000 -> String.format("%.1fk", n / 1_000.0)
        else -> n.toString()
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
                error.text = getString(
                    when (Platforms.normalize(prefs.getString(Constants.KEY_PLATFORM, null))) {
                        Platforms.INSTAGRAM -> R.string.tt_add_post_bad_link_instagram
                        Platforms.FACEBOOK -> R.string.tt_add_post_bad_link_facebook
                        else -> R.string.tt_add_video_bad_link
                    }
                )
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
        val platform = Platforms.normalize(prefs.getString(Constants.KEY_PLATFORM, null))

        // The post list itself comes from the TikTok scraper, but the "paste a link"
        // tile must accept the network the user actually signed in with — otherwise an
        // Instagram or Facebook likes order can never be placed at all.
        when (platform) {
            Platforms.INSTAGRAM -> {
                Regex(
                    """(?:www\.)?instagram\.com/(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)""",
                    RegexOption.IGNORE_CASE
                ).find(withScheme)?.let { return it.groupValues[1] to withScheme }
                return null
            }
            Platforms.FACEBOOK -> {
                Regex(
                    """(?:www\.|m\.)?(?:facebook|fb)\.com/\S*?(?:posts|videos|photos|reel|p)/([A-Za-z0-9_-]+)""",
                    RegexOption.IGNORE_CASE
                ).find(withScheme)?.let { return it.groupValues[1] to withScheme }
                Regex("""[?&](?:fbid|post_id|story_fbid)=(\d+)""", RegexOption.IGNORE_CASE)
                    .find(withScheme)?.let { return it.groupValues[1] to withScheme }
                return null
            }
        }

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
        // Coin packs live behind the balance chip; see showBuyCoinsDialog().
    }

    /**
     * Buy Coins.
     *
     * The packs come from the server's `/v6/products` (type "Coins"), so the coin amount and
     * price are the backend's, not hardcoded in the APK. Tapping a pack opens the Google Play
     * sheet; coins are credited only after `/v6/coins/purchase` verifies the receipt.
     */
    private fun showBuyCoinsDialog() {
        val packs = serverProducts.filter {
            it.productType?.contains("Coin", ignoreCase = true) == true &&
                !it.billingProductId.isNullOrBlank()
        }

        if (packs.isEmpty()) {
            Toast.makeText(this, "Coin packs are loading — try again in a moment.", Toast.LENGTH_SHORT).show()
            loadBoostProducts()
            return
        }

        val labels = packs.map { pack ->
            val price = billingManager.getFormattedPrice(pack.billingProductId!!) ?: pack.price ?: "…"
            "%,d coins  —  %s".format(pack.actionCount, price)
        }.toTypedArray()

        AlertDialog.Builder(this)
            .setTitle("Buy Coins 🪙")
            .setItems(labels) { _, which -> startCoinPackPurchase(packs[which]) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun startCoinPackPurchase(pack: SocialBoostApi.BoostProduct) {
        val billingId = pack.billingProductId ?: return

        if (!billingManager.isBillingReady()) {
            Toast.makeText(this, "Google Play is still connecting — try again in a moment.", Toast.LENGTH_LONG).show()
            return
        }
        if (!billingManager.isProductAvailable(billingId)) {
            // Honest and actionable: the flow is wired, but Play does not know this product yet.
            Toast.makeText(
                this,
                "This coin pack isn't live in Google Play yet (\"$billingId\"). " +
                    "Publish it in Play Console > Monetise > In-app products, then try again.",
                Toast.LENGTH_LONG
            ).show()
            return
        }

        pendingCoinPack = pack
        billingManager.launchPurchaseFlow(billingId)
    }

    /** Credit a verified coin-pack receipt on the server, then re-sync the balance. */
    private fun creditCoinPack(billingProductId: String, purchaseToken: String) {
        val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null)
        if (token.isNullOrBlank()) {
            Toast.makeText(this, "Sign in required to complete purchase", Toast.LENGTH_LONG).show()
            return
        }

        val pack = pendingCoinPack?.takeIf { it.billingProductId == billingProductId }
            ?: serverProducts.firstOrNull { it.billingProductId == billingProductId }
        if (pack == null) {
            Log.w("HomeActivity", "coin pack not found for $billingProductId")
            Toast.makeText(
                this,
                "Payment received, but the pack could not be matched. Contact support with your Google Play order id.",
                Toast.LENGTH_LONG
            ).show()
            return
        }

        Toast.makeText(this, "Crediting ${pack.actionCount} coins…", Toast.LENGTH_SHORT).show()

        Thread {
            try {
                SocialBoostApi.purchaseCoins(token, pack.id, purchaseToken)
                val coins = try {
                    SocialBoostApi.fetchCoins(token)
                } catch (_: Exception) {
                    coinsBalance + pack.actionCount
                }

                runOnUiThread {
                    coinsBalance = coins
                    updateCoinsDisplay()
                    pendingCoinPack = null
                    Toast.makeText(this, "%,d coins added! 🪙".format(pack.actionCount), Toast.LENGTH_LONG).show()
                }
            } catch (e: Exception) {
                Log.w("HomeActivity", "coin credit failed: ${e.message}")
                runOnUiThread {
                    Toast.makeText(
                        this,
                        "Payment received, but coins could not be credited: ${e.message ?: "unknown error"}. " +
                            "Contact support with your Google Play order id.",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }.start()
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
            serverProducts = emptyList()
            boostAdapter.updateServerProducts(emptyList())
            refreshBoostPackageState()
            return
        }

        Thread {
            try {
                val products = SocialBoostApi.fetchProducts(token)
                runOnUiThread {
                    // Kept raw as well: the adapter only renders Follow/Like, so the Coins
                    // packs would otherwise be dropped before the Buy Coins dialog can see them.
                    serverProducts = products
                    boostAdapter.updateServerProducts(products)
                    refreshBoostPackageState()
                }
            } catch (e: Exception) {
                Log.w("HomeActivity", "products fetch failed: ${e.message}")
                if (e is SocialBoostApi.ApiException && e.errorCode == "TokenExpired") {
                    refreshTokenSilently { freshToken ->
                        Thread {
                            try {
                                val retry = SocialBoostApi.fetchProducts(freshToken)
                                runOnUiThread {
                                    serverProducts = retry
                                    boostAdapter.updateServerProducts(retry)
                                    refreshBoostPackageState()
                                }
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

        // Whether this package is anchored to one post (like / share / comment / view) or to
        // the whole profile (followers). The product type decides — the old
        // `contains("Like")` test treated a Shares or Comments order as a followers order,
        // which sent a profile URL and made the server reject it.
        val isLikes = OrderType.fromProductType(typeLabel)?.needsVideoTarget
            ?: typeLabel.contains("Like", ignoreCase = true)

        // A likes order is anchored to ONE video. Sending the profile URL (as this used to)
        // makes the server unable to read a like count, and it rejects the order — which is
        // why buying likes never worked. Ask for the video instead of sending a bad order.
        if (isLikes && selectedVideoUrl.isNullOrBlank()) {
            // The New order screen has its own paste field and video strip now, so send the
            // user there rather than to the old full-screen picker.
            promptForOrderTarget()
            return
        }

        val postPk = if (isLikes) selectedVideoPostPk else null
        val targetUrl = if (isLikes) selectedVideoUrl!! else Constants.profileUrlFor(
            handle, Platforms.normalize(prefs.getString(Constants.KEY_PLATFORM, null))
        )

        Thread {
            fun doOrder(authToken: String) {
                try {
                    SocialBoostApi.createOrder(
                        token = authToken,
                        secUid = secUid,
                        username = handle,
                        url = targetUrl,
                        productId = product.id,
                        postPk = postPk,
                        platform = Platforms.normalize(prefs.getString(Constants.KEY_PLATFORM, null))
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
        // Same rule as the coin path: the product type decides whether this package is a post
        // task (and therefore needs the pasted video link) or a profile task.
        val isLikes = OrderType.fromProductType(product.productType)?.needsVideoTarget
            ?: (product.productType ?: "").contains("Like", ignoreCase = true)

        if (isLikes && selectedVideoUrl.isNullOrBlank()) {
            // The New order screen has its own paste field and video strip now, so send the
            // user there rather than to the old full-screen picker.
            promptForOrderTarget()
            return
        }

        // Refuse before creating anything if Play cannot sell this package.
        //
        // The order is created *first* and paid *second*, so a SKU Play does not know leaves
        // a real `Pending` row behind. Nothing can ever move it: the task feed only serves
        // `Progress`, so no action can be performed on it, and /payment/notify never receives
        // a token for it. The owner then sees it in "Your orders" as "0 / 400" forever and
        // reasonably concludes the app is broken — which is what happened with order #211
        // (a $4.99 card pack whose Play product did not exist yet).
        //
        // `withdrawUnpaidPlayOrder()` exists as a backstop, but it only runs once the
        // checkout sheet was actually opened. Checking here means the ghost is never written.
        if (!billingManager.isBillingReady() || !billingManager.isProductAvailable(billingId)) {
            val reason = if (!billingManager.isBillingReady()) {
                "Google Play is still connecting — try again in a moment. Nothing was ordered."
            } else {
                "This package isn't live in Google Play yet (\"$billingId\"). Nothing was ordered."
            }
            setBillingStatus(reason, isError = true)
            showBillingProblemDialog(reason)
            return
        }

        val postPk = if (isLikes) selectedVideoPostPk else null
        val targetUrl = if (isLikes) selectedVideoUrl!! else Constants.profileUrlFor(
            handle, Platforms.normalize(prefs.getString(Constants.KEY_PLATFORM, null))
        )

        Thread {
            fun doPlayOrder(authToken: String) {
                try {
                    val result = SocialBoostApi.createOrder(
                        token = authToken,
                        secUid = secUid,
                        username = handle,
                        url = targetUrl,
                        productId = product.id,
                        postPk = postPk,
                        platform = Platforms.normalize(prefs.getString(Constants.KEY_PLATFORM, null))
                    )

                    val orderId = result.optInt("id", 0)
                    pendingPlayOrderId = orderId

                    runOnUiThread {
                        if (billingManager.isBillingReady()) {
                            billingManager.launchPurchaseFlow(billingId, orderId)
                        } else {
                            // Billing dropped between the guard and here. The row is already
                            // written, so take it back — a Pending order that no checkout
                            // ever touched can never be activated.
                            withdrawUnpaidPlayOrder()
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
                // The signed-in network. The server resolves the viewer's anchor row by
                // (platform, username); without it a handle that exists on two networks
                // can return the other person's row and every follow is judged against
                // the wrong baseline.
                val platform = Platforms.normalize(prefs.getString(Constants.KEY_PLATFORM, null))
                val page = SocialBoostApi.fetchTasks(token, secUid, handle, pageToLoad, platform)

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
        // Advancing means the previous task is settled — it either paid out or was skipped —
        // so the remembered action must not survive to be re-checked later, and any
        // "the provider was down" marker belongs to that task, not to the next one.
        pendingCheckRetry = false
        forgetPendingVerification()
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
        // "Like" / "Share" / "Comment" / "View" / "Follow" — the card must name the action
        // the performer is actually being asked to take, not just "Like or Follow".
        tvTaskFollowLabel.text = next.actionLabel
        tvTaskReward.text = "+${next.rewardCoins}"

        // Size of the account being boosted, so the task is judgeable at a glance. Left
        // GONE when the network publishes no follower count, because an unknown figure
        // must not be drawn as "0 followers".
        val targetFollowers = next.targetFollowerCount
        if (targetFollowers == null) {
            tvTaskTargetStats.visibility = View.GONE
        } else {
            tvTaskTargetStats.text = buildString {
                append(getString(R.string.tt_followers_count, targetFollowers))
                if (next.targetVerified) {
                    append(" · ").append(getString(R.string.tt_stat_verified))
                }
            }
            tvTaskTargetStats.visibility = View.VISIBLE
        }
        btnTaskFollow.isEnabled = true
        btnTaskFollow.alpha = 1f

        // The heading's status line and reward chip, both describing the task now on
        // screen. While there is no task the chip is hidden outright (see showTaskState),
        // so it can never show the previous task's payout next to "searching".
        tvTaskStatus.text = when (next.action) {
            "like" -> getString(R.string.tt_next_task_like, next.username)
            "share" -> getString(R.string.tt_next_task_share, next.username)
            "comment" -> getString(R.string.tt_next_task_comment, next.username)
            "view" -> getString(R.string.tt_next_task_view, next.username)
            else -> getString(R.string.tt_next_task_follow, next.username)
        }
        // Bare figure, not "+5": the coin mark beside it already says what the number is,
        // and the plus sign made a one-off payout look like a running total.
        tvTaskStatusReward.text = next.rewardCoins.toString()
        layoutTaskStatusReward.visibility = View.VISIBLE

        renderOtherTasks()

        // Try the server mirror first, then whatever URL the feed supplied. The raw URL
        // is a signed TikTok CDN link that expires, so on its own it eventually 403s and
        // the card loses its picture.
        Avatars.load(
            ivTaskAvatar,
            Avatars.candidates(next.username, next.platform, next.imageUrl),
            next.username
        )
        showTaskCover(next)
    }

    /**
     * Put the video a like task is about on the card.
     *
     * A like task asks for one specific post, so the performer has to recognise it — an
     * avatar cannot say which video to open. The feed carries the post's still as
     * `post.cover`, captured when the buyer placed the order from a pasted video link.
     *
     * Two fallbacks matter:
     *   * No still — a follow task, or a like order whose provider returned no cover. Keep
     *     the account picture and leave the still hidden rather than drawing an empty frame.
     *   * The still fails to load. Post stills are signed CDN URLs that expire, so this is
     *     expected some days after the order was placed; drop back to the avatar instead of
     *     leaving a blank card.
     *
     * The callback re-checks the order id before touching any view: a slow load from the
     * previous task must not hide the still belonging to the task now on screen.
     */
    private fun showTaskCover(task: SocialBoostApi.TaskItem) {
        val cover = task.postCover
        if (!task.isLikes || cover.isNullOrBlank()) {
            ivTaskCover.visibility = View.GONE
            viewTaskScrim.visibility = View.GONE
            ivTaskAvatar.visibility = View.VISIBLE
            return
        }

        ivTaskCover.visibility = View.VISIBLE
        viewTaskScrim.visibility = View.VISIBLE
        ivTaskAvatar.visibility = View.GONE

        val forOrder = task.orderId
        try {
            Glide.with(this)
                .load(cover)
                .centerCrop()
                .diskCacheStrategy(DiskCacheStrategy.AUTOMATIC)
                .listener(object : RequestListener<Drawable> {
                    override fun onLoadFailed(
                        e: GlideException?,
                        model: Any?,
                        target: Target<Drawable>,
                        isFirstResource: Boolean
                    ): Boolean {
                        if (currentTask?.orderId == forOrder) {
                            ivTaskCover.visibility = View.GONE
                            viewTaskScrim.visibility = View.GONE
                            ivTaskAvatar.visibility = View.VISIBLE
                        }
                        Log.i("HomeActivity", "task cover failed: ${e?.message}")
                        return true
                    }

                    override fun onResourceReady(
                        resource: Drawable,
                        model: Any,
                        target: Target<Drawable>?,
                        dataSource: DataSource,
                        isFirstResource: Boolean
                    ): Boolean = false
                })
                .into(ivTaskCover)
        } catch (e: Exception) {
            // Glide throws when the Activity is already finishing; the card keeps the avatar.
            Log.i("HomeActivity", "task cover load skipped: ${e.message}")
        }
    }

    /**
     * List the tasks still queued behind the live card.
     *
     * `taskQueue` is mutated in place as tasks advance, so the adapter is handed a copy
     * and never reads the deque directly — a RecyclerView reading a collection that is
     * being popped underneath it is how you get an index crash mid-layout.
     */
    private fun renderOtherTasks() {
        val queued = taskQueue.toList()
        otherTaskAdapter.submit(queued)
        tvOtherTasksEmpty.visibility = if (queued.isEmpty()) View.VISIBLE else View.GONE
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

        // The heading describes the task on screen, so with no task it has to fall back to
        // "searching" — otherwise it keeps describing the card that just left.
        tvTaskStatus.text = getString(R.string.tt_searching_task)
        layoutTaskStatusReward.visibility = View.GONE

        // Every load rebuilds the queue, so an empty list here means "nothing to show",
        // not "out of tasks". Only say so once we have stopped loading, or the note
        // flickers in beside the spinner.
        otherTaskAdapter.submit(emptyList())
        tvOtherTasksEmpty.visibility = if (loading) View.GONE else View.VISIBLE
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

        val appName = Platforms.label(task.platform)

        // If the user already opened the target for this task and taps again:
        if (hasActionBeenOpened && pendingVerificationTask?.orderId == task.orderId) {
            val elapsed = System.currentTimeMillis() - taskOpenedTimestamp
            if (elapsed < 2000) {
                val action = task.actionPhrase
                Toast.makeText(this, "Please $action on $appName first!", Toast.LENGTH_SHORT).show()
                openTaskTarget(task)
                return
            }
            // User was away and tapped to verify:
            runTaskVerification(task, token)
            return
        }

        // First click: record pending task, timestamp, change button to check state, open the target
        pendingVerificationTask = task
        taskOpenedTimestamp = System.currentTimeMillis()
        hasActionBeenOpened = true
        // Also on disk: the user is about to leave for another app, which is when this
        // process is most likely to be killed (see rememberPendingVerification).
        rememberPendingVerification(task)

        tvTaskFollowLabel.text = "Check ⚡"

        // A like is verified by comparing the post's like count before and after, so the
        // "before" snapshot has to be stored *now* — before the user can possibly tap Like.
        // The app is opened only once the snapshot is saved, otherwise a fast user could
        // like the post first and the baseline would already include their own like,
        // permanently denying them the reward.
        if (task.isLikes) {
            Thread {
                try {
                    SocialBoostApi.primeLikeBaseline(
                        token = token,
                        orderId = task.orderId,
                        url = task.url,
                        ttUsername = prefs.getString(Constants.KEY_TIKTOK_USERNAME, null).orEmpty(),
                        secUid = prefs.getString(Constants.KEY_SEC_UID, null),
                        // The baseline describes the TARGET post, so it must be read through
                        // the target's own network provider. Sending the viewer's signed-in
                        // platform made the TikTok scraper read an Instagram URL, which fails
                        // — and used to store a 0 baseline that then "verified" any later like
                        // for free.
                        platform = Platforms.normalize(task.platform)
                    )
                } catch (e: Exception) {
                    Log.w("HomeActivity", "like baseline failed: ${e.message}")
                }
                runOnUiThread { openTaskTarget(task) }
            }.start()
        } else {
            openTaskTarget(task)
        }
    }

    /**
     * Open the task's target on the network it actually belongs to.
     *
     * Three things were wrong here. The fallback URL was hard-coded to TikTok, so a task
     * that arrived without a `url` sent an Instagram user to tiktok.com. The launch was a
     * bare ACTION_VIEW on an https link, which only reaches the app if Android hands the
     * link over — otherwise it opens a browser and nothing says the app is missing. And
     * every message said "TikTok" even on Instagram and Facebook tasks.
     *
     * Now the network's own app is opened directly. A follow task lands on the profile and
     * a like task on the post, because `task.url` already carries the right one. When the
     * app is genuinely absent the user is told so, and the browser takes over so the action
     * can still be performed and credited.
     */
    private fun openTaskTarget(task: SocialBoostApi.TaskItem) {
        val platform = Platforms.normalize(task.platform)
        val appName = Platforms.label(platform)
        val target = task.url.ifBlank { Constants.profileUrlFor(task.username, platform) }
        val pkg = Platforms.androidPackage(platform)

        // 1. Straight to the right screen: an https link addressed to the network's own
        //    package. Instagram and Facebook both claim their profile and post links.
        if (tryStart(Intent(Intent.ACTION_VIEW, Uri.parse(target)).setPackage(pkg))) {
            Toast.makeText(this, openHint(task, appName), Toast.LENGTH_LONG).show()
            return
        }

        // 2. The app is installed but does not claim this link shape — open the app itself
        //    so the user can still reach the profile rather than being told it is missing.
        val launch = packageManager.getLaunchIntentForPackage(pkg)
        if (launch != null && tryStart(launch)) {
            Toast.makeText(this, "$appName is open. ${openHint(task, appName)}", Toast.LENGTH_LONG).show()
            return
        }

        // 3. Not installed. Say so plainly, then let the browser carry it.
        Toast.makeText(this, "$appName app not found — opening in your browser", Toast.LENGTH_LONG).show()
        if (!tryStart(Intent(Intent.ACTION_VIEW, Uri.parse(target)))) {
            Toast.makeText(this, "Could not open $target", Toast.LENGTH_LONG).show()
        }
    }

    /** What the user should do once the target is on screen. */
    private fun openHint(task: SocialBoostApi.TaskItem, appName: String): String {
        // "Like the post", "Share the post", "Comment on the post", "Follow @handle" …
        val phrase = task.actionPhrase.replaceFirstChar { it.uppercaseChar() }
        return "$phrase on $appName, then return here to claim your coins!"
    }

    private fun tryStart(intent: Intent): Boolean = try {
        startActivity(intent)
        true
    } catch (e: Exception) {
        // ActivityNotFoundException when the app is absent, or it does not claim the link.
        Log.i("HomeActivity", "could not open ${intent.data}: ${e.message}")
        false
    }

    private fun handleTaskReturnOnResume() {
        // Going to Instagram or TikTok to perform the action is exactly when this process
        // tends to be evicted, and the in-memory fields go with it. Reload what was stored
        // before concluding there is nothing to do — otherwise a follow that really happened
        // is silently never verified, and the user is never paid for it.
        restorePendingVerification()

        val task = pendingVerificationTask ?: return
        if (!hasActionBeenOpened || isVerifying) return

        // The last attempt could not run because the platform's provider was down. The task
        // is still pending and still claimable, but re-running the check on every resume
        // would just fire another doomed request and another toast. Wait for a deliberate
        // tap on the button instead.
        if (pendingCheckRetry) {
            tvTaskFollowLabel.text = "Check ⚡"
            return
        }

        val appName = Platforms.label(task.platform)
        val elapsed = System.currentTimeMillis() - taskOpenedTimestamp
        if (elapsed >= 2200) {
            // User stayed on the network long enough to perform the action -> verify automatically!
            val token = prefs.getString(Constants.KEY_AUTH_TOKEN, null)
            if (!token.isNullOrBlank()) {
                runTaskVerification(task, token)
            }
        } else {
            // User came back immediately without doing anything:
            tvTaskFollowLabel.text = "Check ⚡"
            val action = task.actionPhrase
            Toast.makeText(
                this,
                "Please complete the $action on $appName to earn coins!",
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

        // A deliberate attempt is under way, so the "stay quiet on resume" flag has done its
        // job. The stored record is NOT cleared here any more: it is only cleared once an
        // outcome that actually settles the task arrives (claimed, or provably not done).
        // Clearing it up front made a check that could not run — the provider being down —
        // indistinguishable from a real refusal, and the user's genuine follow was lost.
        pendingCheckRetry = false

        val handle = prefs.getString(Constants.KEY_TIKTOK_USERNAME, null).orEmpty()
        val secUid = prefs.getString(Constants.KEY_SEC_UID, null)

        Thread {
            try {
                // Brief verification animation pause so the user sees the checking state
                Thread.sleep(700)

                // Returns more than a number: `retryable` distinguishes "we read your account
                // and nothing moved" from "we could not read your account at all".
                val result = SocialBoostApi.verifyTask(
                    token = token,
                    orderId = task.orderId,
                    secUid = secUid,
                    ttUsername = handle,
                    targetUsername = task.username,
                    isLikes = task.isLikes,
                    actionCompleted = true,
                    // The action was performed on the TASK's network, so that is the
                    // network whose provider must read the viewer's counter. Sending the
                    // signed-in platform made the server measure the wrong account: a
                    // follow done on Instagram was checked against the viewer's TikTok
                    // following count, which cannot have moved, so the task never paid.
                    // This must also match the platform used to prime the like baseline
                    // (see completeCurrentTask) or the baseline row is looked up on the
                    // wrong network and the checker throws "Previous like count not found".
                    platform = Platforms.normalize(task.platform)
                )

                runOnUiThread {
                    isVerifying = false
                    btnTaskFollow.isEnabled = true
                    btnTaskFollow.alpha = 1f

                    when {
                        result.coins > 0 -> {
                            // Take the balance from the server, do not compute it here.
                            //
                            // `coinsBalance += result.coins` was a guess that only agrees
                            // with the ledger if nothing else touched the balance between
                            // this screen loading and the credit landing. It does not
                            // agree after a bonus, an unfollow clawback or a credit from
                            // another device, which is how a user ends up being told
                            // "coins added" while the number on screen never moves.
                            val reported = result.balance
                            if (reported != null) {
                                coinsBalance = reported
                            }
                            prefs.edit().putInt(Constants.KEY_COINS, coinsBalance).apply()
                            updateCoinsDisplay()
                            // A server that did not report the balance (an older build):
                            // ask it, rather than adding the delta ourselves.
                            if (reported == null) refreshCoinsFromServer(silent = true)

                            val action = task.actionLabel
                            Toast.makeText(
                                this,
                                "🎉 $action verified! +${result.coins} Coins added!",
                                Toast.LENGTH_LONG
                            ).show()

                            forgetPendingVerification()
                            pendingVerificationTask = null
                            hasActionBeenOpened = false
                            showNextTask()
                        }

                        result.retryable -> {
                            // The platform's provider is unreachable, so nothing was proven —
                            // neither that the action was done nor that it was not. Keep the
                            // task pending and leave the button on "Check ⚡" so the very same
                            // task can be claimed once the provider is back. Saying "please
                            // complete the action" here is what told a user who had just
                            // followed to go and follow again, and then discarded the task.
                            pendingCheckRetry = true
                            tvTaskFollowLabel.text = "Check ⚡"
                            Toast.makeText(
                                this,
                                result.message
                                    ?: "${Platforms.label(task.platform)} is temporarily " +
                                        "unavailable — tap Check again in a few minutes.",
                                Toast.LENGTH_LONG
                            ).show()
                        }

                        else -> {
                            // A genuine refusal: the server read the account and its counter
                            // did not move, so the action really has not been performed.
                            val action = task.actionLabel
                            tvTaskFollowLabel.text = action
                            Toast.makeText(
                                this,
                                "Could not verify. Please complete the action on " +
                                    "${Platforms.label(task.platform)} to earn coins.",
                                Toast.LENGTH_LONG
                            ).show()
                            forgetPendingVerification()
                            pendingVerificationTask = null
                            hasActionBeenOpened = false
                        }
                    }
                }
            } catch (e: Exception) {
                Log.w("HomeActivity", "coins/check failed: ${e.message}")
                runOnUiThread {
                    isVerifying = false
                    btnTaskFollow.isEnabled = true
                    btnTaskFollow.alpha = 1f
                    val action = task.actionLabel
                    tvTaskFollowLabel.text = action
                    Toast.makeText(
                        this,
                        e.message ?: "Verification failed",
                        Toast.LENGTH_LONG
                    ).show()
                    // A hard error (no network, expired token) settles nothing, so the stored
                    // record is dropped here exactly as before — [pendingCheckRetry] is not
                    // set, so the ordinary "open the task again" path is unchanged.
                    forgetPendingVerification()
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
        // Disabled, because a client-side promo cannot be honest about coins.
        //
        // It cannot change what Google Play charges, and it must not mint coins on the device
        // either: this used to do `coinsBalance += 250`, adding 250 coins to the local cache
        // that the server had never granted. The balance looked topped up until the next /me
        // refresh reverted it, while the affordability checks on Store and Tasks used the
        // inflated figure — so a "promo" let a user attempt orders the server would refuse.
        //
        // A promo grant has to be a real, auditable coin credit on the server, the way the
        // welcome and daily bonuses are written through the coins_histories ledger
        // (see lib/services/welcomeBonus.js and lib/services/dailyBonus.js). Until that
        // endpoint exists the field stays disabled rather than faking a balance.
        etPromo.isEnabled = false
        btnApplyPromo.isEnabled = false
        tvPromoApplied.visibility = View.VISIBLE
        tvPromoApplied.text = "Promo codes are not available yet"
        btnApplyPromo.setOnClickListener {
            Toast.makeText(this, "Promo codes are not available yet", Toast.LENGTH_SHORT).show()
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
