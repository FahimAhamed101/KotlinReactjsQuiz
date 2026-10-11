package com.Fahim101.tomquiz.utils

import com.Fahim101.tomquiz.model.CodeItem
import org.json.JSONArray

object Constants {

    const val USER_NAME = "user_name"
    const val TOTAL_QUESTIONS = "total_questions"
    const val SCORE = "correct_answers"
    const val SELECTED_TAB = "selected_tab"

    const val PREFS_NAME = "buy_codes_quiz_prefs"
    const val KEY_PURCHASED_IDS = "purchased_code_ids"
    /**
     * Codes unlocked by spending coins.
     *
     * Kept separate from [KEY_PURCHASED_IDS] because a Google Play restore
     * overwrites that set with what Play reports — which would silently wipe
     * every coin unlock, since Play knows nothing about them.
     */
    const val KEY_COIN_UNLOCKED_IDS = "coin_unlocked_code_ids"
    const val KEY_IS_SUBSCRIPTION_ACTIVE = "is_subscription_active"
    const val KEY_PURCHASES_PURGED_V2 = "purchases_purged_v2"
    const val KEY_COINS = "user_coins"

    const val PROJECTS_API_URL = "https://detech-git-master-fahimahamed101s-projects.vercel.app/api/projects"
    const val PROJECTS_BASE_URL = "https://getyoursoftware.top"

    // ---------------------------------------------------------------------
    // SocialBoost API (the Next.js service in /socialboostapi)
    // ---------------------------------------------------------------------

    /**
     * Base URL of the SocialBoost API.
     *
     * 10.0.2.2 is the host machine as seen from the Android emulator. On a
     * physical device with `adb reverse tcp:4000 tcp:4000`, 127.0.0.1:4000 forwards over USB to the dev PC.
     */
    val TTBOOST_API_URL: String
        get() = if (isEmulator()) "http://10.0.2.2:4000" else "http://192.168.0.101:4000"

    fun isEmulator(): Boolean {
        val fp = android.os.Build.FINGERPRINT
        val model = android.os.Build.MODEL
        val hw = android.os.Build.HARDWARE
        val brand = android.os.Build.BRAND
        val device = android.os.Build.DEVICE
        val product = android.os.Build.PRODUCT
        return fp.startsWith("generic")
                || fp.startsWith("unknown")
                || model.contains("google_sdk", ignoreCase = true)
                || model.contains("Emulator", ignoreCase = true)
                || model.contains("Android SDK built for x86", ignoreCase = true)
                || android.os.Build.MANUFACTURER.contains("Genymotion", ignoreCase = true)
                || (brand.startsWith("generic") && device.startsWith("generic"))
                || "google_sdk" == product
                || hw == "goldfish"
                || hw == "ranchu"
    }

    /**
     * Must match HASH_VALUE in the server's .env — the login routes require
     * `hash = sha256(HASH_VALUE)`.
     */
    const val TTBOOST_HASH_VALUE = "nesyou is the best"

    /**
     * HMAC secret for the X-Signature header. Must match APP_KEY in the server's
     * .env; the `base64:...` form is decoded, exactly as the server does.
     *
     * This ships inside the APK, so it stops URL-scanners rather than a determined
     * attacker who decompiles the app. Pair it with a per-install credential for a
     * real security boundary.
     */
    const val TTBOOST_APP_KEY = "base64:dGhpcy1pcy1hLWRldi1vbmx5LWtleS1jaGFuZ2UtbWU="

    const val KEY_AUTH_TOKEN = "ttboost_auth_token"
    const val KEY_SEC_UID = "ttboost_sec_uid"
    const val KEY_TIKTOK_USERNAME = "ttboost_tiktok_username"
    const val KEY_LOGIN_ID = "ttboost_login_id"

    /**
     * Optional server-side receipt verification endpoint (the Node service in /buycodeprobackend).
     * Leave BLANK to run 100% on-device through Google Play Billing.
     * Do NOT point this at the portfolio site - it has no /api/payment/notify route.
     */
    const val PAYMENT_BACKEND_URL = ""

    // ---------------------------------------------------------------------
    // Google Play Billing product IDs
    // ---------------------------------------------------------------------

    /** The one subscription product. Must exist in Play Console as a subscription. */
    const val SUBSCRIPTION_PRODUCT_ID = "codes_access_5usd_monthly"

    /**
     * Reverse map: Play product ID -> catalog code id.
     * Used to restore purchases the user already owns (e.g. after a reinstall).
     */
    val PRODUCT_ID_TO_CODE_ID: Map<String, String> = mapOf(
        "code_food_multivendor" to "69b9ef585fe0c15cfbca6d3b",
        "code_neibrly_flutter" to "6984e9b6f026fe71568258a6",
        "code_macbook_store" to "697d3ed590415b15c3aa2dbd",
        "code_book_shop" to "697d3dc290415b15c3aa2dbc",
        "code_crud_project" to "697d3d47ad90aedd55387afe",
        "code_flutter_ecommerce" to "690fcd79c0edf355752753fd",
        "code_flutter_news" to "690d228feca5e2de5d5ef7d6",
        "code_kotlin_quiz" to "690d075fe59332546baeb0b4",
        "code_kotlin_shop" to "690cee658e96d8a70fe1803f",
        "code_laravel_ecommerce" to "6905319d2c2d2e85ceb41ecb",
        "code_laravel_news" to "68e84de5a5a54f24a2170f43",
        "code_lebaba_ecommerce" to "681c9dcdf01f9e20b2991b46",
        "code_greatcart_django" to "678853f530e5f35b94e1e0df",
        "code_upfront_multivendor" to "6685b645897ef7ab9f47ae44",
        "code_mern_ecommerce" to "65e77f03ec80a2fd64c5b16c",
        "code_react_chat" to "65e604edbf0394fec16562be",
        "code_nextjs_portfolio" to "65e213f64019178ad26e1986"
    )

    /** Catalog code id -> Play product ID (the inverse of [PRODUCT_ID_TO_CODE_ID]). */
    private val CODE_ID_TO_PRODUCT_ID: Map<String, String> =
        PRODUCT_ID_TO_CODE_ID.entries.associate { (productId, codeId) -> codeId to productId }

    /**
     * Boost product IDs — bought with Google Play money (not coins).
     * These are SocialBoost followers/likes packages and coin packs.
     */
    val BOOST_PRODUCT_IDS: List<String> = listOf(
        "tt_follow_200",
        "tt_follow_400",
        "tt_follow_900",
        "tt_follow_2000",
        "tt_follow_4300",
        "tt_follow_9000",
        "tt_like_300",
        "tt_like_600",
        "tt_like_1300",
        "tt_like_2700",
        "tt_like_5600",
        "tt_like_11500",
        "tt_follow_1000",
        "tt_like_1000",
        "tt_follow_9_99_discount",
        "tt_coin_19_99",
        "tt_coin_99_99",
    )

    /**
     * EVERY one-time product the app can sell.
     * This is the single source of truth: [BillingManager] queries exactly these IDs and
     * nothing else. If an ID is missing here, the item can never be purchased.
     */
    val PLAY_PRODUCT_IDS: List<String> = PRODUCT_ID_TO_CODE_ID.keys.toList() + BOOST_PRODUCT_IDS

    /**
     * Resolve the Play product ID for a catalog entry.
     * Known codes map to their registered product; unknown/new codes fall back to a
     * deterministic slug so the ID is still stable and printable for Play Console setup.
     */
    fun productIdForCode(codeId: String, title: String = ""): String {
        CODE_ID_TO_PRODUCT_ID[codeId]?.let { return it }

        val slug = title.lowercase()
            .replace(Regex("[^a-z0-9]+"), "_")
            .trim('_')
            .take(35)
            .ifBlank { "code_item" }

        val candidate = "code_$slug"
        // Never collide with an already-registered product ID.
        return if (PLAY_PRODUCT_IDS.contains(candidate)) "${candidate}_x" else candidate
    }

    /** Play product ID -> catalog code id, or null when the product is unknown. */
    fun codeIdForProductId(productId: String): String? = PRODUCT_ID_TO_CODE_ID[productId]

    /** True when the given Play product ID is the subscription. */
    fun isSubscription(productId: String): Boolean = productId == SUBSCRIPTION_PRODUCT_ID

    /** True when the given Play product ID is a boost package (followers/likes/coins). */
    fun isBoostProduct(productId: String): Boolean = BOOST_PRODUCT_IDS.contains(productId)

    fun parseProjectsJson(jsonString: String): MutableList<CodeItem> {
        val items = mutableListOf<CodeItem>()
        try {
            val jsonArray = JSONArray(jsonString)
            for (i in 0 until jsonArray.length()) {
                val obj = jsonArray.getJSONObject(i)
                val id = obj.optString("id", "code_$i")
                val rawTitle = obj.optString("title", "Project Codebase")
                val title = rawTitle.replace("\n", " ").trim()
                val rawDesc = obj.optString("description", "")
                // Strip markdown headers, bold, links and HTML tags
                val cleanDesc = rawDesc
                    .replace(Regex("<[^>]*>"), "")
                    .replace(Regex("#{1,6}\\s*"), "")
                    .replace(Regex("\\*\\*|__"), "")
                    .replace(Regex("\\[([^\\]]+)\\]\\([^\\)]+\\)"), "$1")
                    .replace(Regex("-{3,}"), " ")
                    .trim()
                    .ifEmpty {
                        "Full production codebase with modern architecture, API integration, and clean code."
                    }
                val category = obj.optString("category", "Full-Stack").ifEmpty { "Full-Stack" }

                var github = obj.optString("github", "").trim()
                if (!github.startsWith("http")) {
                    val repoSlug = title.replace(Regex("[^a-zA-Z0-9]"), "")
                    github = "https://github.com/FahimAhamed101/$repoSlug"
                }

                val rawLink = obj.optString("link", "").trim()
                val webLink = if (rawLink.startsWith("http")) rawLink else "$PROJECTS_BASE_URL$rawLink"

                // Parse images: some are full URLs, some are local paths
                val imagesStr = obj.optString("images", "")
                val allImages = imagesStr.split(",")
                    .map { it.trim() }
                    .filter { it.isNotBlank() }
                    .map { img ->
                        when {
                            img.startsWith("http") -> img
                            img.startsWith("/") -> "$PROJECTS_BASE_URL$img"
                            else -> "$PROJECTS_BASE_URL/$img"
                        }
                    }
                val imageUrl = allImages.firstOrNull() ?: ""

                // Budget pricing between $4.99 and $29.99 USD (competitive like CodeCanyon)
                val budgetPrices = listOf(4.99, 6.99, 8.99, 9.99, 11.99, 13.99, 15.99, 17.99, 19.99, 24.99, 29.99)
                val priceIndex = Math.abs(id.hashCode()) % budgetPrices.size
                val priceUsd = budgetPrices[priceIndex]
                val priceStr = "$${String.format("%.2f", priceUsd)} USD"
                val origPriceUsd = (priceUsd * 2.8).toInt() + 0.99
                val origPriceStr = "$${String.format("%.2f", origPriceUsd)}"
                val discountPercent = (((origPriceUsd - priceUsd) / origPriceUsd) * 100).toInt()
                val discountStr = "$discountPercent% OFF"

                val badges = listOf("BESTSELLER", "HOT", "NEW", "POPULAR", "FEATURED", "TOP RATED", "TRENDING")
                val badge = badges[Math.abs(id.hashCode()) % badges.size]

                val rating = 4.7 + ((Math.abs(id.hashCode()) % 30) / 100.0)
                val buyersCount = 120 + (Math.abs(id.hashCode()) % 3500)

                // Extract features from description lines that start with bullet points or dashes
                val descFeatures = rawDesc.lines()
                    .map { it.trim() }
                    .filter { it.startsWith("-") || it.startsWith("*") || it.startsWith("•") }
                    .map { it.replace(Regex("^[-*•]\\s*"), "") }
                    .filter { it.length > 5 }
                    .take(4)

                val techFeatures = category.split(",")
                    .map { it.trim() }
                    .filter { it.isNotBlank() }
                    .map { "Built with $it" }
                    .take(4)

                val featuresList = if (descFeatures.isNotEmpty()) descFeatures else techFeatures
                    .ifEmpty { listOf("Clean Modular Architecture", "Production Ready Code", "Documentation Included", "Lifetime Updates") }

                val sampleSnippet = "// $title\n// Repository: $github\n// Category: $category\n// Live Demo: $webLink\n\nexport async function initApp() {\n  console.log('Running $title...');\n  return { status: 'unlocked', repoUrl: '$github', demo: '$webLink' };\n}"

                items.add(CodeItem(
                    id = id,
                    productId = productIdForCode(id, title),
                    title = title,
                    category = category,
                    description = cleanDesc,
                    price = priceStr,
                    priceUsd = priceUsd,
                    coinsPrice = (priceUsd * 35).toInt().coerceIn(300, 1500),
                    originalPrice = origPriceStr,
                    discount = discountStr,
                    rating = String.format("%.2f", rating).toDouble(),
                    buyersCount = buyersCount,
                    badge = badge,
                    features = featuresList,
                    repoUrl = github,
                    sampleSnippet = sampleSnippet,
                    isPurchased = false,
                    imageUrl = imageUrl,
                    imageUrls = allImages,
                    webLink = webLink
                ))
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return items
    }

    fun getCodeCatalog(): MutableList<CodeItem> {
        val codes = mutableListOf<CodeItem>()

        codes.add(CodeItem(
            id = "69b9ef585fe0c15cfbca6d3b",
            productId = "code_food_multivendor",
            title = "Food-Multivendor Restaurant App",
            category = "React-Native,Tanstack Query,Zustand",
            description = "A multivendor Restaurant system. Shows restaurant foods based on location. Users can order food via Stripe.",
            price = "$18.99 USD",
            priceUsd = 18.99,
            originalPrice = "$49.99",
            discount = "62% OFF",
            rating = 4.95,
            buyersCount = 1840,
            badge = "BESTSELLER",
            features = listOf(
                "React-Native Cross-Platform UI",
                "Tanstack Query Data Fetching & Caching",
                "Zustand State Management",
                "Stripe Online Payment Integration"
            ),
            repoUrl = "https://github.com/FahimAhamed101/Food-deliveryApp",
            sampleSnippet = "// React Native Order Service\nexport async function placeFoodOrder(cartItems, location) {\n  const stripeToken = await requestStripePayment();\n  return await api.post('/orders', { items: cartItems, location, stripeToken });\n}",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1773793100/rebjtceyfmlypkeoh9p0.png",
            imageUrls = listOf(
                "https://res.cloudinary.com/fahim1213456/image/upload/v1773793100/rebjtceyfmlypkeoh9p0.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1773793100/qmfji24p5cuooffmuapi.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1773793101/wn9n7z8oecor4yx7swpi.png"
            ),
            webLink = "https://github.com/FahimAhamed101/Food-deliveryApp"
        ))

        codes.add(CodeItem(
            id = "6984e9b6f026fe71568258a6",
            productId = "code_neibrly_flutter",
            title = "neibrly Flutter Provider App",
            category = "Flutter,Dart,Getx,Socket.io,Expressjs,Nodejs,Mongodb",
            description = "A Customer & Provider Service-based application made with Flutter, GetX, Socket.io, Node.js backend.",
            price = "$21.99 USD",
            priceUsd = 21.99,
            originalPrice = "$59.99",
            discount = "63% OFF",
            rating = 4.92,
            buyersCount = 1420,
            badge = "HOT",
            features = listOf(
                "Flutter & Dart Cross Platform App",
                "GetX State Management & Routing",
                "Real-time Socket.io Chat & Notifications",
                "Express.js & MongoDB Backend Engine"
            ),
            repoUrl = "https://github.com/FahimAhamed101/Nebrly",
            sampleSnippet = "// Flutter GetX Service Controller\nclass ServiceController extends GetxController {\n  final socket = io('https://nebrly-api.com', OptionBuilder().setTransports(['websocket']).build());\n  void listenBookings() { socket.on('new_service', (data) => update()); }\n}",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1770318080/nmvvveaxzw0vzen58a30.png",
            imageUrls = listOf(
                "https://res.cloudinary.com/fahim1213456/image/upload/v1770318080/nmvvveaxzw0vzen58a30.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1770318080/dj9xqy2ou6wspmh1ptws.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1770318080/urfagchfhfuei6ykmi98.png"
            ),
            webLink = "https://github.com/FahimAhamed101/Nebrly"
        ))

        codes.add(CodeItem(
            id = "697d3ed590415b15c3aa2dbd",
            productId = "code_macbook_store",
            title = "Macbook Store E-Commerce System",
            category = "asp .net,c#,Angular",
            description = "A high-performance Macbook shop created with Angular, RxJS, and ASP.NET Core C# backend.",
            price = "$14.99 USD",
            priceUsd = 14.99,
            originalPrice = "$39.99",
            discount = "62% OFF",
            rating = 4.88,
            buyersCount = 980,
            badge = "FEATURED",
            features = listOf(
                "Angular Frontend with RxJS Streams",
                "ASP.NET Core Web API C#",
                "Entity Framework Core & SQL Server",
                "Product Catalog & Secure Checkout"
            ),
            repoUrl = "https://github.com/FahimAhamed101/Aspecommerce",
            sampleSnippet = "// ASP.NET Core API Controller\n[HttpGet(\"products\")]\npublic async Task<ActionResult<List<Product>>> GetProducts() {\n    return await _context.Products.ToListAsync();\n}",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1775757672/vwdgxjkwswjp8bdemh70.png",
            imageUrls = listOf(
                "https://res.cloudinary.com/fahim1213456/image/upload/v1775757672/vwdgxjkwswjp8bdemh70.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1775757672/kpxtpwhwncd5guqrtqpv.png"
            ),
            webLink = "https://github.com/FahimAhamed101/Aspecommerce"
        ))

        codes.add(CodeItem(
            id = "697d3dc290415b15c3aa2dbc",
            productId = "code_book_shop",
            title = "Online Book Shop Application",
            category = "asp .net,c#,Nextjs,RTK Query",
            description = "A modern online bookshop created with ASP.NET Core C# backend, Next.js frontend, and RTK Query.",
            price = "$11.99 USD",
            priceUsd = 11.99,
            originalPrice = "$34.99",
            discount = "65% OFF",
            rating = 4.86,
            buyersCount = 820,
            badge = "POPULAR",
            features = listOf(
                "Next.js App Router Frontend",
                "RTK Query API Caching State",
                "ASP.NET Core REST APIs",
                "Shopping Cart & Order Management"
            ),
            repoUrl = "https://github.com/FahimAhamed101/asp.net-bookshop",
            sampleSnippet = "// RTK Query Api Service\nexport const bookApi = createApi({\n  reducerPath: 'bookApi',\n  endpoints: (builder) => ({\n    getBooks: builder.query({ query: () => '/books' }),\n  }),\n});",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1769815480/tye0gxh2cztcqiwdkcyc.png",
            imageUrls = listOf(
                "https://res.cloudinary.com/fahim1213456/image/upload/v1769815480/tye0gxh2cztcqiwdkcyc.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1769815481/xxkdittbepybazpxwsto.png"
            ),
            webLink = "https://github.com/FahimAhamed101/asp.net-bookshop"
        ))

        codes.add(CodeItem(
            id = "697d3d47ad90aedd55387afe",
            productId = "code_crud_project",
            title = ".NET Core & Next.js Full-Stack Starter",
            category = ".net core,C#,Nextjs",
            description = "A clean full-stack CRUD application template created with .NET Core C# Web API and Next.js.",
            price = "$6.99 USD",
            priceUsd = 6.99,
            originalPrice = "$19.99",
            discount = "65% OFF",
            rating = 4.80,
            buyersCount = 1150,
            badge = "STARTER",
            features = listOf(
                "Full CRUD Operations & Validation",
                "Clean Architecture Solution Pattern",
                "Next.js Modern React UI",
                "C# .NET Core RESTful API"
            ),
            repoUrl = "https://github.com/FahimAhamed101/crudasp",
            sampleSnippet = "// Next.js Fetch API\nexport async function getCrudData() {\n  const res = await fetch(process.env.API_URL + '/items');\n  return res.json();\n}",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1769815356/rgwswxk8i4chumfaqjng.png",
            imageUrls = listOf("https://res.cloudinary.com/fahim1213456/image/upload/v1769815356/rgwswxk8i4chumfaqjng.png"),
            webLink = "https://github.com/FahimAhamed101/crudasp"
        ))

        codes.add(CodeItem(
            id = "690fcd79c0edf355752753fd",
            productId = "code_flutter_ecommerce",
            title = "Flutter Multivendor E-Commerce App",
            category = "Flutter,Dart,provider,Expressjs,Nodejs,Mongodb",
            description = "A Flutter Multivendor App created with Flutter & Provider. Uses Express, MongoDB, and Node.js on backend.",
            price = "$19.99 USD",
            priceUsd = 19.99,
            originalPrice = "$49.99",
            discount = "60% OFF",
            rating = 4.94,
            buyersCount = 2100,
            badge = "BESTSELLER",
            features = listOf(
                "Multi-Vendor Store & Products",
                "Flutter Provider State Management",
                "Node.js Express & MongoDB Database",
                "User Cart, Orders & Payment Gateways"
            ),
            repoUrl = "https://github.com/FahimAhamed101/flutterecommerce",
            sampleSnippet = "// Flutter Provider Product Fetch\nclass ProductProvider with ChangeNotifier {\n  List<Product> _items = [];\n  Future<void> fetchProducts() async {\n    _items = await ApiService.getProducts();\n    notifyListeners();\n  }\n}",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1762643313/ontvbr6zdknvbgdbcl8o.png",
            imageUrls = listOf(
                "https://res.cloudinary.com/fahim1213456/image/upload/v1762643313/ontvbr6zdknvbgdbcl8o.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1762643313/xee4sitp3zp3jbabrmte.png"
            ),
            webLink = "https://github.com/FahimAhamed101/flutterecommerce"
        ))

        codes.add(CodeItem(
            id = "690d228feca5e2de5d5ef7d6",
            productId = "code_flutter_news",
            title = "Flutter News & Article App",
            category = "Flutter,Dart",
            description = "A responsive, feature-rich News App Created with Flutter, supporting category feeds and bookmarking.",
            price = "$8.99 USD",
            priceUsd = 8.99,
            originalPrice = "$24.99",
            discount = "64% OFF",
            rating = 4.85,
            buyersCount = 1320,
            badge = "POPULAR",
            features = listOf(
                "Clean Material 3 Flutter UI",
                "Category Filtering & Live Search",
                "Offline Reading & Local Bookmarks",
                "Dark Mode & Custom Reader Theme"
            ),
            repoUrl = "https://github.com/FahimAhamed101/NewsFlutter",
            sampleSnippet = "// Flutter News Widget\nWidget buildNewsCard(Article article) {\n  return ListTile(\n    title: Text(article.title),\n    subtitle: Text(article.sourceName),\n  );\n}",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1762468488/abpxhcsotjhdxhyc89ye.png",
            imageUrls = listOf("https://res.cloudinary.com/fahim1213456/image/upload/v1762468488/abpxhcsotjhdxhyc89ye.png"),
            webLink = "https://github.com/FahimAhamed101/NewsFlutter"
        ))

        codes.add(CodeItem(
            id = "690d075fe59332546baeb0b4",
            productId = "code_kotlin_quiz",
            title = "Kotlin Native Quiz Pro Application",
            category = "Kotlin,Android",
            description = "An interactive Quiz Application built natively with Kotlin for Android, including scoring and timer.",
            price = "$12.99 USD",
            priceUsd = 12.99,
            originalPrice = "$34.99",
            discount = "62% OFF",
            rating = 4.96,
            buyersCount = 1650,
            badge = "HOT",
            features = listOf(
                "Native Kotlin Android Studio Architecture",
                "Interactive Question Engine & Timer",
                "High-score Leaderboard & Rewards",
                "Custom Themes & Sound Effects"
            ),
            repoUrl = "https://github.com/FahimAhamed101/KotlinReactjsQuiz",
            sampleSnippet = "// Kotlin Quiz Engine\nfun checkAnswer(selectedOption: Int): Boolean {\n    val isCorrect = selectedOption == currentQuestion.correctAnswer\n    if (isCorrect) score += 10\n    return isCorrect\n}",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1762461525/dsaelobgp4yx4cgidlzn.png",
            imageUrls = listOf(
                "https://res.cloudinary.com/fahim1213456/image/upload/v1762461525/dsaelobgp4yx4cgidlzn.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1762461526/ne6lu9kg7wrjoxsrhf0p.png"
            ),
            webLink = "https://github.com/FahimAhamed101/KotlinReactjsQuiz"
        ))

        codes.add(CodeItem(
            id = "690cee658e96d8a70fe1803f",
            productId = "code_kotlin_shop",
            title = "Kotlin Multi-Vendor E-Commerce & Firebase",
            category = "Kotlin,Firebase,Android",
            description = "A full Multivendor Ecommerce Shop created with Kotlin and Firebase Authentication/Firestore.",
            price = "$24.99 USD",
            priceUsd = 24.99,
            originalPrice = "$69.99",
            discount = "64% OFF",
            rating = 4.98,
            buyersCount = 2200,
            badge = "TOP RATED",
            features = listOf(
                "Native Kotlin Android Shopping App",
                "Firebase Firestore Realtime Database",
                "Vendor Product Management Dashboard",
                "Push Notifications & Order Tracking"
            ),
            repoUrl = "https://github.com/FahimAhamed101/kotlinshop",
            sampleSnippet = "// Firebase Firestore Order Flow\nfun placeOrder(order: Order) {\n    db.collection(\"orders\").add(order)\n        .addOnSuccessListener { Log.d(\"Shop\", \"Order created\") }\n}",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1762455129/zdgqe0j528a81yycfh8f.png",
            imageUrls = listOf(
                "https://res.cloudinary.com/fahim1213456/image/upload/v1762455129/zdgqe0j528a81yycfh8f.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1762455129/zarbhvulnqpokfgnwc1v.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1762455129/qf97my1qmgqv9x1nengu.png"
            ),
            webLink = "https://github.com/FahimAhamed101/kotlinshop"
        ))

        codes.add(CodeItem(
            id = "6905319d2c2d2e85ceb41ecb",
            productId = "code_laravel_ecommerce",
            title = "Laravel Full-Featured E-Commerce System",
            category = "Laravel,Php,MySQL",
            description = "Full-featured eCommerce web application built with Laravel PHP framework, Blade templates & Vercel deployment.",
            price = "$16.99 USD",
            priceUsd = 16.99,
            originalPrice = "$44.99",
            discount = "62% OFF",
            rating = 4.89,
            buyersCount = 1450,
            badge = "POPULAR",
            features = listOf(
                "Laravel MVC Framework Architecture",
                "Eloquent ORM Database Relations",
                "Admin Product & Inventory Panel",
                "Stripe & PayPal Checkout Integration"
            ),
            repoUrl = "https://github.com/FahimAhamed101/LaravelSEcommerce",
            sampleSnippet = "// Laravel Order Controller\npublic function checkout(Request \$request) {\n    \$order = Order::create(\$request->all());\n    return response()->json(['success' => true, 'order_id' => \$order->id]);\n}",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1761948055/vechahayrxk7rn2lsboa.png",
            imageUrls = listOf(
                "https://res.cloudinary.com/fahim1213456/image/upload/v1761948055/vechahayrxk7rn2lsboa.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1761948055/y2ht3c6so4hshseuvpq3.png"
            ),
            webLink = "https://laravel-s-ecommerce.vercel.app/"
        ))

        codes.add(CodeItem(
            id = "68e84de5a5a54f24a2170f43",
            productId = "code_laravel_news",
            title = "Laravel Multi-Language News Portal",
            category = "Laravel,Php,MySQL",
            description = "A news portal with multiple language support and role management (Admin, Author, Writer) created with Laravel.",
            price = "$11.99 USD",
            priceUsd = 11.99,
            originalPrice = "$32.99",
            discount = "63% OFF",
            rating = 4.87,
            buyersCount = 920,
            badge = "FEATURED",
            features = listOf(
                "Multi-Language & Localization System",
                "Role-Based Access Control (RBAC)",
                "Rich Text News Editor & Media Manager",
                "SEO Optimized Slug & Metadata"
            ),
            repoUrl = "https://github.com/FahimAhamed101/laratopnews",
            sampleSnippet = "// Laravel Middleware Role Check\npublic function handle(\$request, Closure \$next, ...\$roles) {\n    if (in_array(\$request->user()->role, \$roles)) return \$next(\$request);\n}",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1760054747/mvhvgsaoiefhtja7admt.png",
            imageUrls = listOf(
                "https://res.cloudinary.com/fahim1213456/image/upload/v1760054747/mvhvgsaoiefhtja7admt.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1760054751/qjl2ggffu51qgw9kkxsv.png"
            ),
            webLink = "https://laratopnews.vercel.app/"
        ))

        codes.add(CodeItem(
            id = "681c9dcdf01f9e20b2991b46",
            productId = "code_lebaba_ecommerce",
            title = "Lebaba MERN Stack E-Commerce Platform",
            category = "Reactjs,Nodejs,Express,Mongodb",
            description = "A full-stack Ecommerce Platform created with React.js, Node.js Express backend, and MongoDB database.",
            price = "$15.99 USD",
            priceUsd = 15.99,
            originalPrice = "$42.99",
            discount = "62% OFF",
            rating = 4.91,
            buyersCount = 1780,
            badge = "BESTSELLER",
            features = listOf(
                "React.js Single Page Application",
                "Express.js & Node.js RESTful APIs",
                "MongoDB Mongoose Data Schemas",
                "JWT Authentication & Cart System"
            ),
            repoUrl = "https://github.com/FahimAhamed101/mern_ecom",
            sampleSnippet = "// Node.js Express Auth Router\nrouter.post('/login', async (req, res) => {\n  const user = await User.findOne({ email: req.body.email });\n  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);\n  res.json({ token, user });\n});",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1746705758/eklalbpnqxisg31os4xx.png",
            imageUrls = listOf(
                "https://res.cloudinary.com/fahim1213456/image/upload/v1746705758/eklalbpnqxisg31os4xx.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1746705798/krlemkok3ieox7k36yqz.png"
            ),
            webLink = "https://reactnodeshop.vercel.app/"
        ))

        codes.add(CodeItem(
            id = "678853f530e5f35b94e1e0df",
            productId = "code_greatcart_django",
            title = "Greatcart Python & Django Store Engine",
            category = "Django,python,PostgreSQL",
            description = "A complete E-Commerce Solution created with Python and Django framework including cart, checkout & admin.",
            price = "$13.99 USD",
            priceUsd = 13.99,
            originalPrice = "$36.99",
            discount = "62% OFF",
            rating = 4.88,
            buyersCount = 1100,
            badge = "POPULAR",
            features = listOf(
                "Django Web Framework & ORM",
                "Custom User Authentication Model",
                "Shopping Cart & Order Session State",
                "Admin Dashboard & Order Status"
            ),
            repoUrl = "https://github.com/FahimAhamed101/greatkart",
            sampleSnippet = "# Django Cart View\ndef add_cart(request, product_id):\n    product = Product.objects.get(id=product_id)\n    cart, _ = Cart.objects.get_or_create(cart_id=_cart_id(request))\n    return redirect('cart')",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1749276125/sai3zmalos01ixgw8yno.png",
            imageUrls = listOf("https://res.cloudinary.com/fahim1213456/image/upload/v1749276125/sai3zmalos01ixgw8yno.png"),
            webLink = "https://djangoshop-three.vercel.app/en/"
        ))

        codes.add(CodeItem(
            id = "6685b645897ef7ab9f47ae44",
            productId = "code_upfront_multivendor",
            title = "Upfront React & Django Multi-Vendor Store",
            category = "Django,python,Reactjs,Zustand",
            description = "A Multivendor E-Commerce website created with React.js, Zustand state, and Django Rest Framework.",
            price = "$22.99 USD",
            priceUsd = 22.99,
            originalPrice = "$59.99",
            discount = "61% OFF",
            rating = 4.96,
            buyersCount = 1950,
            badge = "TOP RATED",
            features = listOf(
                "React.js Single Page App with Zustand",
                "Django Rest Framework (DRF) Backend",
                "Multi-Vendor Store Management",
                "Cross-Origin CORS & JWT Security"
            ),
            repoUrl = "https://github.com/FahimAhamed101/upfront-ecommerce",
            sampleSnippet = "// Zustand React Store\nexport const useCartStore = create((set) => ({\n  cart: [],\n  addToCart: (item) => set((state) => ({ cart: [...state.cart, item] })),\n}));",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1749276749/iwmhjepo97nz0dbij1n4.png",
            imageUrls = listOf("https://res.cloudinary.com/fahim1213456/image/upload/v1749276749/iwmhjepo97nz0dbij1n4.png"),
            webLink = "https://djangoreactmultivendor.vercel.app/"
        ))

        codes.add(CodeItem(
            id = "65e77f03ec80a2fd64c5b16c",
            productId = "code_mern_ecommerce",
            title = "MERN Stack E-Commerce & Stripe",
            category = "Reactjs,Nodejs,Express,Tailwind",
            description = "Full e-commerce website made with React, Node, TailwindCSS, and Stripe payments with admin panel.",
            price = "$17.99 USD",
            priceUsd = 17.99,
            originalPrice = "$48.99",
            discount = "63% OFF",
            rating = 4.93,
            buyersCount = 2600,
            badge = "BESTSELLER",
            features = listOf(
                "TailwindCSS Modern Styling",
                "Stripe Checkout & Webhook Integration",
                "Admin Product & Sales Analytics",
                "Node.js Express & MongoDB Server"
            ),
            repoUrl = "https://github.com/FahimAhamed101/mernfrontend",
            sampleSnippet = "// Stripe Checkout Backend\napp.post('/api/create-checkout-session', async (req, res) => {\n  const session = await stripe.checkout.sessions.create({ line_items: req.body.items, mode: 'payment' });\n  res.json({ url: session.url });\n});",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1709670131/untqbkz4914ivpqtsaig.png",
            imageUrls = listOf(
                "https://res.cloudinary.com/fahim1213456/image/upload/v1709670131/untqbkz4914ivpqtsaig.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1709670140/vwkcg8c02zkyhe3zyozc.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1709670142/rnqutwwez9m5ckx0viuk.png"
            ),
            webLink = "https://mernshop10.vercel.app/"
        ))

        codes.add(CodeItem(
            id = "65e604edbf0394fec16562be",
            productId = "code_react_chat",
            title = "Real-Time React & Socket.io Chat App",
            category = "Reactjs,Nodejs,Socket.io,Mongodb",
            description = "A real-time Chat application created with React.js, Node.js, MongoDB, and Socket.io web sockets.",
            price = "$9.99 USD",
            priceUsd = 9.99,
            originalPrice = "$28.99",
            discount = "65% OFF",
            rating = 4.90,
            buyersCount = 2150,
            badge = "HOT",
            features = listOf(
                "Socket.io WebSockets Instant Messaging",
                "Online Status & Typing Indicators",
                "MongoDB Message History Storage",
                "Group Chats & Direct Messaging"
            ),
            repoUrl = "https://github.com/FahimAhamed101/chat-MERN",
            sampleSnippet = "// Socket.io Realtime Listener\nsocket.on('message_received', (newMessage) => {\n  setMessages((prev) => [...prev, newMessage]);\n});",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1709573240/uxuqefufrszlw6bkebap.png",
            imageUrls = listOf(
                "https://res.cloudinary.com/fahim1213456/image/upload/v1709573240/uxuqefufrszlw6bkebap.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1709573255/hphiy1dcgwghnyvpeako.png"
            ),
            webLink = "https://chatmern-fk3b.onrender.com"
        ))

        codes.add(CodeItem(
            id = "65e213f64019178ad26e1986",
            productId = "code_nextjs_portfolio",
            title = "Next.js & Prisma Portfolio Platform",
            category = "nextjs,Typescript,Prisma",
            description = "Full developer portfolio created with Next.js, TypeScript, Prisma ORM, and Cloudinary media uploading.",
            price = "$7.99 USD",
            priceUsd = 7.99,
            originalPrice = "$22.99",
            discount = "65% OFF",
            rating = 4.89,
            buyersCount = 1890,
            badge = "STARTER",
            features = listOf(
                "Next.js App Router & Server Components",
                "Prisma ORM Database Schema",
                "Cloudinary Image Upload API",
                "Responsive Dark Mode Theme"
            ),
            repoUrl = "https://github.com/FahimAhamed101/Fahimportoflio",
            sampleSnippet = "// Next.js Server Component\nexport default async function Portfolio() {\n  const projects = await prisma.project.findMany();\n  return <ProjectGrid projects={projects} />;\n}",
            imageUrl = "https://res.cloudinary.com/fahim1213456/image/upload/v1709315001/k553cdtzgnfcuf0ioqes.png",
            imageUrls = listOf(
                "https://res.cloudinary.com/fahim1213456/image/upload/v1709315001/k553cdtzgnfcuf0ioqes.png",
                "https://res.cloudinary.com/fahim1213456/image/upload/v1709315142/drbegdscy3gvcpvfimtf.png"
            ),
            webLink = "https://fahimportoflio.vercel.app/"
        ))

        return codes.mapTo(mutableListOf<CodeItem>()) {
            it.copy(
                productId = productIdForCode(it.id, it.title),
                coinsPrice = if (it.coinsPrice > 0) it.coinsPrice else (it.priceUsd * 35).toInt().coerceIn(300, 1500)
            )
        }
    }
}