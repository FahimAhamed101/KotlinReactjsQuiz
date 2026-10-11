package com.Fahim101.tomquiz

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.Fahim101.tomquiz.ui.HomeActivity
import com.Fahim101.tomquiz.utils.Constants
import com.Fahim101.tomquiz.utils.SocialBoostApi

/**
 * Entry screen — authenticates against the SocialBoost API.
 *
 * The user supplies their TikTok handle. We derive a stable login identifier from
 * it, then:
 *
 *   1. try `POST /v6/login`
 *   2. if the server says `UserNotRegistered`, fall back to `POST /v6/register`
 *
 * and store the returned bearer token plus the resolved TikTok account. That token
 * is what lets the Tasks screen earn coins.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var prefs: android.content.SharedPreferences
    private lateinit var editUsername: EditText
    private lateinit var startButton: Button
    private lateinit var progress: ProgressBar
    private lateinit var tvStatus: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        prefs = getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)

        // Already signed in? Skip straight to Home.
        if (!prefs.getString(Constants.KEY_AUTH_TOKEN, null).isNullOrBlank()) {
            goHome()
            return
        }

        setContentView(R.layout.activity_main)

        editUsername = findViewById(R.id.name)
        startButton = findViewById(R.id.button_start)
        progress = findViewById(R.id.progress_login)
        tvStatus = findViewById(R.id.tv_login_status)

        prefs.getString(Constants.KEY_TIKTOK_USERNAME, null)?.let {
            editUsername.setText(it)
        }

        startButton.setOnClickListener { signIn() }
    }

    private fun signIn() {
        val username = editUsername.text.toString().trim().removePrefix("@")

        if (username.isEmpty()) {
            Toast.makeText(this, "Please enter your TikTok username", Toast.LENGTH_SHORT).show()
            return
        }
        // The server enforces 2..24 chars and ^(?!.*\.$)[a-zA-Z0-9._]+$; fail fast locally.
        if (username.length < 2 || username.length > 24 ||
            !Regex("^(?!.*\\.$)[a-zA-Z0-9._]+$").matches(username)
        ) {
            Toast.makeText(
                this,
                "Usernames are 2-24 characters: letters, numbers, dots and underscores",
                Toast.LENGTH_LONG
            ).show()
            return
        }

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

        prefs.edit()
            .putString(Constants.KEY_AUTH_TOKEN, token)
            .putString(Constants.KEY_LOGIN_ID, fallbackUsername)
            .putString(
                Constants.KEY_TIKTOK_USERNAME,
                tiktok?.optString("uniqueId")?.ifBlank { null } ?: fallbackUsername
            )
            .putString(Constants.KEY_SEC_UID, tiktok?.optString("secUid"))
            .putString(Constants.USER_NAME, tiktok?.optString("nickname")?.ifBlank { null } ?: fallbackUsername)
            .apply()
    }

    private fun setLoading(loading: Boolean, status: String? = null) {
        startButton.isEnabled = !loading
        startButton.alpha = if (loading) 0.6f else 1f
        progress.visibility = if (loading) View.VISIBLE else View.GONE

        if (status != null) {
            tvStatus.text = status
            tvStatus.visibility = View.VISIBLE
        } else {
            tvStatus.visibility = View.GONE
        }
    }

    private fun goHome() {
        startActivity(Intent(this, HomeActivity::class.java))
        finish()
    }
}
