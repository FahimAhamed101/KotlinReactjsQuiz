package com.Fahim101.tomquiz

import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowInsetsControllerCompat
import android.view.LayoutInflater
import com.Fahim101.tomquiz.ui.HomeActivity
import com.Fahim101.tomquiz.utils.Avatars
import com.Fahim101.tomquiz.utils.Constants
import com.Fahim101.tomquiz.utils.Platforms
import com.Fahim101.tomquiz.utils.SocialBoostApi
import com.Fahim101.tomquiz.utils.TikTokHandle
import com.google.android.material.button.MaterialButtonToggleGroup

/**
 * Entry screen — authenticates against the SocialBoost API.
 *
 * There are **two** ways to sign in, and the second one is optional:
 *
 *   1. **Type your handle** and press Get Started. The app derives a login id from
 *      it, calls `POST /v6/login`, and falls back to `POST /v6/register` when the
 *      server answers `UserNotRegistered`.
 *   2. **Let the platform supply the handle** ("Already signed in to TikTok"). The
 *      phone is normally already logged in to TikTok, so instead of asking the user to
 *      remember and retype their handle we open TikTok, let them copy their profile
 *      link, and read it back off the clipboard when they return — then sign in
 *      automatically with the handle we found.
 *
 * The user picks **TikTok or Instagram** with the toggle above the input. That choice
 * is part of their identity, not a preference: `@demo` on TikTok and `@demo` on
 * Instagram are two different people with two different profile pictures, so the
 * server keys every account by (platform, username) and the app has to know which
 * network it is looking at before it can show the right face.
 *
 * Whichever path runs, the outcome is the same: a bearer token plus the resolved
 * account are stored, and that token is what lets the Tasks screen earn coins.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var prefs: android.content.SharedPreferences
    private lateinit var editUsername: EditText
    private lateinit var startButton: Button
    private lateinit var tiktokButton: Button
    private lateinit var progress: ProgressBar
    private lateinit var tvStatus: TextView
    private lateinit var platformToggle: MaterialButtonToggleGroup

    /**
     * The network the entered handle belongs to.
     *
     * Read from the toggle rather than tracked separately, so there is exactly one
     * source of truth for "which platform am I signing in to".
     */
    private val selectedPlatform: String
        get() = when (platformToggle.checkedButtonId) {
            R.id.btn_platform_instagram -> Platforms.INSTAGRAM
            R.id.btn_platform_facebook -> Platforms.FACEBOOK
            else -> Platforms.TIKTOK
        }

    /**
     * True between opening the platform app and coming back, so the clipboard read
     * is wanted. Without it we would inspect the clipboard on every resume, including
     * the one that fires right after a normal cold start.
     */
    private var awaitingTiktokReturn = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Pin the system bars before anything else. On Android 12+ the system tints them
        // from `colorPrimary` unless the window pins an opaque colour, and on API 35+
        // `android:statusBarColor` in the theme is ignored entirely — so this is what keeps
        // a lavender status bar from appearing over the navy UI.
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
        window.statusBarColor = ContextCompat.getColor(this, R.color.tt_top_bar)
        window.navigationBarColor = ContextCompat.getColor(this, R.color.tt_top_bar)
        androidx.core.view.WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            isAppearanceLightNavigationBars = false
        }

        prefs = getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)

        // Already signed in? Skip straight to Home.
        if (!prefs.getString(Constants.KEY_AUTH_TOKEN, null).isNullOrBlank()) {
            goHome()
            return
        }

        setContentView(R.layout.activity_main)

        editUsername = findViewById(R.id.name)
        startButton = findViewById(R.id.button_start)
        tiktokButton = findViewById(R.id.button_tiktok)
        progress = findViewById(R.id.progress_login)
        tvStatus = findViewById(R.id.tv_login_status)
        platformToggle = findViewById(R.id.platform_toggle)

        // Restore the platform the user last signed in with, so switching back and
        // forth does not silently reset it to TikTok.
        val savedPlatform = prefs.getString(Constants.KEY_PLATFORM, null)
        platformToggle.check(
            if (Platforms.normalize(savedPlatform) == Platforms.INSTAGRAM) {
                R.id.btn_platform_instagram
            } else {
                R.id.btn_platform_tiktok
            }
        )

        // Switching platform changes the handle rules, the field hint and the whole
        // "let the app supply it" path — so the label has to follow the toggle.
        platformToggle.addOnButtonCheckedListener { _, checkedId, isChecked ->
            if (isChecked) onPlatformChanged()
        }
        onPlatformChanged()

        prefs.getString(Constants.KEY_TIKTOK_USERNAME, null)?.let {
            editUsername.setText(it)
        }

        startButton.setOnClickListener { signIn() }
        tiktokButton.setOnClickListener { openTikTok() }
    }

    /**
     * Re-label the screen for the platform the user picked.
     *
     * The field hint used to say "TikTok username", which became a lie the moment
     * Instagram was selectable. The second button is also TikTok-specific — handing
     * the identity check to Instagram works differently — so it is hidden for
     * Instagram rather than left to do the wrong thing.
     */
    private fun onPlatformChanged() {
        val platform = selectedPlatform
        val label = Platforms.label(platform)

        val hintRes = when (platform) {
            Platforms.INSTAGRAM -> R.string.tt_username_hint_instagram
            Platforms.FACEBOOK -> R.string.tt_username_hint_facebook
            else -> R.string.tt_username_hint_tiktok
        }
        val hint = getString(hintRes)
        editUsername.hint = hint
        // The TextInputLayout owns the floating label above the box; setting only the
        // EditText's hint leaves that label showing the previous platform's text.
        findViewById<com.google.android.material.textfield.TextInputLayout>(R.id.username_layout)
            ?.hint = hint

        // The "already signed in" shortcut works for every network — it opens that
        // network's own app and reads the profile link off the clipboard — so it stays
        // visible for all three. Only its wording follows the toggle; the old version
        // hid it for Instagram and still said "TikTok" in its hint.
        tiktokButton.text = getString(R.string.tt_already_signed_in, label)
        findViewById<TextView>(R.id.tv_tiktok_hint)?.text =
            getString(R.string.tt_already_hint, label)
    }

    // ------------------------------------------------------------------
    // Path 2: let TikTok supply the handle
    // ------------------------------------------------------------------

    /**
     * Open the TikTok app so the user can copy their own profile link.
     *
     * We cannot read TikTok's internal session — no app can — so the identity is
     * established by the user copying their profile link from the account TikTok is
     * already signed in to, and us reading the handle out of it on return.
     */
    private fun openTikTok() {
        awaitingTiktokReturn = true

        val platform = selectedPlatform
        val packages = when (platform) {
            Platforms.INSTAGRAM -> INSTAGRAM_PACKAGES
            Platforms.FACEBOOK -> FACEBOOK_PACKAGES
            else -> TIKTOK_PACKAGES
        }
        val website = when (platform) {
            Platforms.INSTAGRAM -> "https://www.instagram.com/"
            Platforms.FACEBOOK -> "https://www.facebook.com/"
            else -> "https://www.tiktok.com/"
        }
        val appName = Platforms.label(platform)

        val launched = packages.any { pkg ->
            val intent = packageManager.getLaunchIntentForPackage(pkg)
            if (intent == null) {
                false
            } else {
                try {
                    startActivity(intent)
                    true
                } catch (e: Exception) {
                    Log.w("MainActivity", "could not launch $pkg: ${e.message}")
                    false
                }
            }
        }

        if (launched) {
            Toast.makeText(
                this,
                "Open your profile, tap Share → Copy link, then come back here.",
                Toast.LENGTH_LONG
            ).show()
            return
        }

        // The app is not installed — the browser can still show the site.
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(website)))
            Toast.makeText(
                this,
                "$appName app not found — opened the website. Copy your profile link and come back.",
                Toast.LENGTH_LONG
            ).show()
        } catch (e: Exception) {
            awaitingTiktokReturn = false
            Toast.makeText(
                this,
                "Could not open $appName. Please type your username instead.",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    /**
     * Android 10+ refuses clipboard reads until the app actually owns the window
     * focus. `onResume` fires before that, so it is only a first attempt; the focus
     * callback is the one that reliably succeeds, and is where we report failure.
     */
    override fun onResume() {
        super.onResume()
        harvestHandleIfWaiting(warn = false)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) harvestHandleIfWaiting(warn = true)
    }

    private fun harvestHandleIfWaiting(warn: Boolean) {
        if (!awaitingTiktokReturn) return

        val handle = readHandleFromClipboard()
        if (handle != null) {
            awaitingTiktokReturn = false
            editUsername.setText(handle)
            Toast.makeText(this, "Found @$handle — signing you in…", Toast.LENGTH_SHORT).show()

            // "Automatically logged in with his username": we already have the handle,
            // so there is no reason to make the user press Get Started as well.
            signIn()
            return
        }

        if (warn) {
            awaitingTiktokReturn = false
            Toast.makeText(
                this,
                "No ${Platforms.label(selectedPlatform)} profile link on the clipboard yet — " +
                    "copy it in the app, then tap the button again.",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    /** Read whatever the user last copied and try to find a handle in it. */
    private fun readHandleFromClipboard(): String? {
        return try {
            val clipboard = getSystemService(ClipboardManager::class.java) ?: return null
            val clip = clipboard.primaryClip ?: return null
            if (clip.itemCount == 0) return null
            val text = clip.getItemAt(0).coerceToText(this).toString()
            when (selectedPlatform) {
                Platforms.INSTAGRAM -> TikTokHandle.extractInstagram(text)
                Platforms.FACEBOOK -> TikTokHandle.extractFacebook(text)
                else -> TikTokHandle.extract(text)
            }
        } catch (e: Exception) {
            Log.w("MainActivity", "clipboard read failed: ${e.message}")
            null
        }
    }

    // ------------------------------------------------------------------
    // Shared: sign in with whatever handle we have
    // ------------------------------------------------------------------

    private fun signIn() {
        val platform = selectedPlatform
        val raw = editUsername.text.toString().trim()

        if (raw.isEmpty()) {
            Toast.makeText(
                this,
                if (platform == Platforms.FACEBOOK) {
                    "Please paste your Facebook page or profile link"
                } else {
                    "Please enter your ${Platforms.label(platform)} username"
                },
                Toast.LENGTH_SHORT
            ).show()
            return
        }

        // Normalise through the platform's own parser instead of just stripping "@".
        // Facebook users paste a profile URL far more often than a slug, and a pasted
        // URL that is only stripped of "@" is not a handle — it would be sent to the
        // server verbatim and resolve to nobody.
        val username = when (platform) {
            Platforms.INSTAGRAM -> TikTokHandle.extractInstagram(raw)
            Platforms.FACEBOOK -> TikTokHandle.extractFacebook(raw)
            else -> TikTokHandle.extract(raw) ?: raw.removePrefix("@")
        }

        if (username == null || !TikTokHandle.isValid(username, platform)) {
            Toast.makeText(
                this,
                when (platform) {
                    Platforms.INSTAGRAM ->
                        "Instagram usernames are up to 30 characters: letters, numbers, dots and underscores"
                    Platforms.FACEBOOK ->
                        "Paste a Facebook page or profile link — e.g. facebook.com/yourpage " +
                            "or facebook.com/profile.php?id=1000..."
                    else ->
                        "Usernames are 2-24 characters: letters, numbers, dots and underscores"
                },
                Toast.LENGTH_LONG
            ).show()
            return
        }

        // Show the handle that will actually be looked up. A pasted Facebook link
        // otherwise leaves the raw URL in the field, which looks like it was ignored.
        if (username != raw) editUsername.setText(username)

        // Straight to login/register — one server round-trip, exactly as before.
        //
        // There used to be a profile lookup here first, so the user could confirm "is this
        // me?" before an account existed. That made sign-in take TWO sequential round-trips
        // (lookup, then login), which on a cold server start doubled the wait and made the
        // button look dead. The login response already carries the account's `tiktok_info`,
        // and Home loads the real picture and counts on entry, so the preview is no longer
        // worth the latency — the profile still shows the right person, just immediately
        // after sign-in instead of before it.
        completeSignIn(username, platform)
    }

    /**
     * Show the resolved profile so the user can confirm it is theirs *before* signing in.
     *
     * This is where "I typed my username and nothing about me appears" gets fixed: the
     * picture and counts they see here are the real ones, fetched from the platform, and the
     * preview is also what stores them — so the profile section is correct from the moment
     * the app opens rather than only after a successful login.
     */
    private fun showProfilePreview(profile: SocialBoostApi.ProfileInfo, fallbackUsername: String) {
        val handle = profile.username ?: fallbackUsername
        // The profile carries the network it was resolved from; trusting it here
        // rather than re-reading the toggle keeps the preview and the sign-in on
        // the same platform even if the user flips the toggle while it loads.
        val platform = Platforms.normalize(profile.platform)
        val view = LayoutInflater.from(this).inflate(R.layout.dialog_profile_preview, null)

        val ivAvatar = view.findViewById<ImageView>(R.id.iv_preview_avatar)
        val tvHandle = view.findViewById<TextView>(R.id.tv_preview_handle)
        val tvName = view.findViewById<TextView>(R.id.tv_preview_name)
        val tvStats = view.findViewById<TextView>(R.id.tv_preview_stats)
        val tvError = view.findViewById<TextView>(R.id.tv_preview_missing)

        tvHandle.text = "@$handle"
        tvName.text = profile.nickname ?: handle

        val stats = buildList {
            if (profile.followers > 0) add("${profile.followers} followers")
            if (profile.following > 0) add("${profile.following} following")
        }
        tvStats.text = stats.joinToString("  ·  ")
        tvStats.visibility = if (stats.isEmpty()) View.GONE else View.VISIBLE

        // What the offline stub produces. Rather than showing a stranger's photo as if it
        // were the user's, say that the real picture needs a provider - a wrong picture
        // looks exactly like a broken one from the outside.
        val placeholder = profile.avatarLarger?.contains("picsum") == true
        if (placeholder) {
            tvError.setText(R.string.tt_preview_no_key)
            tvError.visibility = View.VISIBLE
        }
        Avatars.load(
            ivAvatar,
            Avatars.candidates(handle, platform, profile.avatarUrl, profile.avatarLarger),
            handle
        )

        val dialog = AlertDialog.Builder(this)
            .setView(view)
            .setCancelable(true)
            .create()

        view.findViewById<View>(R.id.btn_preview_not_me).setOnClickListener {
            dialog.dismiss()
            editUsername.requestFocus()
        }
        view.findViewById<View>(R.id.btn_preview_continue).setOnClickListener {
            dialog.dismiss()
            // Store the resolved identity now, so it is right even if the next step fails.
            prefs.edit()
                .putString(Constants.KEY_TIKTOK_USERNAME, handle)
                .putString(Constants.KEY_PLATFORM, platform)
                .putString(Constants.KEY_AVATAR_URL, profile.avatarUrl ?: profile.avatarLarger)
                .putString(Constants.USER_NAME, profile.nickname ?: handle)
                .apply()
            completeSignIn(handle, platform)
        }

        dialog.show()
    }

    /**
     * The login/register step.
     *
     * `platform` is passed in rather than read from the toggle here: the request already
     * runs on a worker thread by the time it matters, so the user could flip the toggle
     * mid-flight and the account created must be the one for the network whose handle
     * they actually typed.
     *
     * The login id namespaces by platform too. It used to be just
     * `username@ttboost.app`, which was fine while TikTok was the only network — but
     * `@demo` on Instagram is a different person from `@demo` on TikTok, and both would
     * derive the same id, so whichever signed in second landed inside the first one's
     * account. TikTok keeps the original shape so every existing account still resolves.
     */
    private fun completeSignIn(username: String, platform: String) {
        setLoading(true, "Connecting to SocialBoost...")

        val platformKey = Platforms.normalize(platform)
        val loginId = if (platformKey == Platforms.TIKTOK) {
            "$username@ttboost.app"
        } else {
            "$username@$platformKey.ttboost.app"
        }

        Thread {
            try {
                val data = try {
                    SocialBoostApi.login(loginId, username, platform = platformKey)
                } catch (e: SocialBoostApi.ApiException) {
                    // Unknown user -> create it.
                    if (e.errorCode == "UserNotRegistered") {
                        runOnUiThread { setLoading(true, "Creating your account...") }
                        SocialBoostApi.register(loginId, username, platform = platformKey)
                    } else {
                        throw e
                    }
                }

                persistSession(data, username, platformKey)
                runOnUiThread { goHome() }
            } catch (e: Exception) {
                Log.w("MainActivity", "Sign-in failed: ${e.message}")
                runOnUiThread {
                    setLoading(false)
                    Toast.makeText(
                        this,
                        e.message ?: "Could not reach the SocialBoost server",
                        Toast.LENGTH_LONG
                    ).show()
                }
            }
        }.start()
    }

    /** Store the token and the resolved account for later calls. */
    private fun persistSession(data: org.json.JSONObject, fallbackUsername: String, platform: String) {
        val token = data.optJSONObject("auth")?.optString("token").orEmpty()
        val tiktok = data.optJSONObject("tiktok_info")

        // `optString(key)` returns the LITERAL STRING "null" when the JSON value is
        // null, because it routes through JSONObject.NULL.toString(). That is not
        // blank, so `.ifBlank { null }` does not catch it and the profile would be
        // stored as the string "null". Test isNull() first — same trap that once
        // rendered the welcome-bonus ledger row as "@null".
        fun field(key: String): String? {
            if (tiktok == null || tiktok.isNull(key)) return null
            return tiktok.optString(key).ifBlank { null }
        }

        prefs.edit()
            .putString(Constants.KEY_AUTH_TOKEN, token)
            .putString(Constants.KEY_LOGIN_ID, fallbackUsername)
            .putString(Constants.KEY_TIKTOK_USERNAME, field("uniqueId") ?: fallbackUsername)
            // The signed-in network. Everything downstream — the avatar URL, the profile
            // refresh, the order avatars — is keyed by (platform, username), so this must
            // be stored or the app would fall back to TikTok and show the wrong person.
            .putString(Constants.KEY_PLATFORM, Platforms.normalize(platform))
            .putString(Constants.KEY_SEC_UID, field("secUid"))
            .putString(Constants.KEY_AVATAR_URL, field("avatarLarger"))
            .putString(Constants.USER_NAME, field("nickname") ?: fallbackUsername)
            .apply()
    }

    private fun setLoading(loading: Boolean, status: String? = null) {
        startButton.isEnabled = !loading
        startButton.alpha = if (loading) 0.6f else 1f
        tiktokButton.isEnabled = !loading
        tiktokButton.alpha = if (loading) 0.6f else 1f
        progress.visibility = if (loading) View.VISIBLE else View.GONE

        if (status != null) {
            tvStatus.text = status
            tvStatus.visibility = View.VISIBLE
        } else {
            tvStatus.visibility = View.GONE
        }
    }

    /**
     * A message the user is meant to read and act on — a handle that does not exist, for
     * instance. Unlike the transient status, it stays on screen until the next attempt.
     */
    private fun setLoginStatus(message: String, isError: Boolean) {
        tvStatus.text = message
        tvStatus.visibility = View.VISIBLE
        tvStatus.setTextColor(
            ContextCompat.getColor(this, if (isError) R.color.tt_tip_red else R.color.tt_text_secondary)
        )
        // The input stays up and focused so the next action is editing the username, not
        // hunting for the field again.
        editUsername.requestFocus()
    }

    private fun goHome() {
        startActivity(Intent(this, HomeActivity::class.java))
        finish()
    }

    companion object {
        /**
         * Same ids the reference TTBoost APK declares in its `<queries>`. Order
         * matters only in that the mainstream package is tried first.
         */
        private val TIKTOK_PACKAGES = listOf(
            "com.zhiliaoapp.musically",
            "com.ss.android.ugc.tiktok",
            "com.tiktok",
            "com.zhiliaoapp.musically.go",
        )

        /**
         * Instagram's own app. Listed before "Lite" so the full app wins when both are
         * installed, matching the order TikTok's list uses for its mainstream build.
         */
        private val INSTAGRAM_PACKAGES = listOf(
            "com.instagram.android",
            "com.instagram.lite",
        )

        /**
         * Facebook ships a full client (`katana`) and the lightweight `lite` client,
         * plus the Meta "app manager" that some devices install instead.
         */
        private val FACEBOOK_PACKAGES = listOf(
            "com.facebook.katana",
            "com.facebook.lite",
        )
    }
}
