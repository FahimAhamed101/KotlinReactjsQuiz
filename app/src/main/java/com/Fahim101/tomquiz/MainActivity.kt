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
import com.Fahim101.tomquiz.utils.SocialBoostApi
import com.Fahim101.tomquiz.utils.TikTokHandle

/**
 * Entry screen — authenticates against the SocialBoost API.
 *
 * There are **two** ways to sign in, and the second one is optional:
 *
 *   1. **Type your handle** and press Get Started. The app derives a login id from
 *      it, calls `POST /v6/login`, and falls back to `POST /v6/register` when the
 *      server answers `UserNotRegistered`.
 *   2. **Let TikTok supply the handle** ("Already signed in to TikTok"). The phone
 *      is normally already logged in to TikTok, so instead of asking the user to
 *      remember and retype their handle we open TikTok, let them copy their profile
 *      link, and read it back off the clipboard when they return — then sign in
 *      automatically with the handle we found.
 *
 * Whichever path runs, the outcome is the same: a bearer token plus the resolved
 * TikTok account are stored, and that token is what lets the Tasks screen earn coins.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var prefs: android.content.SharedPreferences
    private lateinit var editUsername: EditText
    private lateinit var startButton: Button
    private lateinit var tiktokButton: Button
    private lateinit var progress: ProgressBar
    private lateinit var tvStatus: TextView

    /**
     * True between opening TikTok and coming back, so the clipboard read is wanted.
     * Without it we would inspect the clipboard on every resume, including the one
     * that fires right after a normal cold start.
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

        prefs.getString(Constants.KEY_TIKTOK_USERNAME, null)?.let {
            editUsername.setText(it)
        }

        startButton.setOnClickListener { signIn() }
        tiktokButton.setOnClickListener { openTikTok() }
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

        val launched = TIKTOK_PACKAGES.any { pkg ->
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

        // TikTok is not installed — the browser can still show the site.
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.tiktok.com/")))
            Toast.makeText(
                this,
                "TikTok app not found — opened the website. Copy your profile link and come back.",
                Toast.LENGTH_LONG
            ).show()
        } catch (e: Exception) {
            awaitingTiktokReturn = false
            Toast.makeText(
                this,
                "Could not open TikTok. Please type your username instead.",
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
                "No TikTok profile link on the clipboard yet — copy it in TikTok, then tap the button again.",
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
            TikTokHandle.extract(clip.getItemAt(0).coerceToText(this).toString())
        } catch (e: Exception) {
            Log.w("MainActivity", "clipboard read failed: ${e.message}")
            null
        }
    }

    // ------------------------------------------------------------------
    // Shared: sign in with whatever handle we have
    // ------------------------------------------------------------------

    private fun signIn() {
        val username = editUsername.text.toString().trim().removePrefix("@")

        if (username.isEmpty()) {
            Toast.makeText(this, "Please enter your TikTok username", Toast.LENGTH_SHORT).show()
            return
        }
        if (!TikTokHandle.isValid(username)) {
            Toast.makeText(
                this,
                "Usernames are 2-24 characters: letters, numbers, dots and underscores",
                Toast.LENGTH_LONG
            ).show()
            return
        }

        // Resolve the handle *before* creating anything. The point is that the first screen
        // answers "is this really me, with my picture" while it is still cheap to fix a typo,
        // instead of after an account has been created for a handle that is not theirs.
        setLoading(true, "Looking up @$username…")

        Thread {
            var profile: SocialBoostApi.ProfileInfo? = null
            try {
                profile = SocialBoostApi.lookupProfile(Constants.PLATFORM_DEFAULT, username)
            } catch (e: Exception) {
                Log.w("MainActivity", "lookup failed: ${e.message}")
            }

            runOnUiThread {
                setLoading(false)
                if (profile == null) {
                    setLoginStatus(
                        "Could not find @$username on TikTok. Check the spelling and try again.",
                        isError = true
                    )
                    return@runOnUiThread
                }
                showProfilePreview(profile, username)
            }
        }
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
        Avatars.load(ivAvatar, Avatars.candidates(handle, profile.avatarUrl, profile.avatarLarger), handle)

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
                .putString(Constants.KEY_PLATFORM, Constants.PLATFORM_DEFAULT)
                .putString(Constants.KEY_AVATAR_URL, profile.avatarUrl ?: profile.avatarLarger)
                .putString(Constants.USER_NAME, profile.nickname ?: handle)
                .apply()
            completeSignIn(handle)
        }

        dialog.show()
    }

    /** The login/register step, once the user has confirmed the profile is theirs. */
    private fun completeSignIn(username: String) {
        setLoading(true, "Connecting to SocialBoost…")

        // A deterministic identifier so the same handle always maps to one account.
        val loginId = "$username@ttboost.app"

        Thread {
            try {
                val data = try {
                    SocialBoostApi.login(loginId, username)
                } catch (e: SocialBoostApi.ApiException) {
                    // Unknown user -> create it.
                    if (e.errorCode == "UserNotRegistered") {
                        runOnUiThread { setLoading(true, "Creating your account…") }
                        SocialBoostApi.register(loginId, username)
                    } else {
                        throw e
                    }
                }

                persistSession(data, username)
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

    /** Store the token and the resolved TikTok account for later calls. */
    private fun persistSession(data: org.json.JSONObject, fallbackUsername: String) {
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
    }
}
