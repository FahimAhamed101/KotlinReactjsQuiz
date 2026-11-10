package com.Fahim101.tomquiz.utils

/**
 * The social networks this app can sign in with.
 *
 * Why this is a separate object rather than a constant on [Constants]: the platform
 * is part of a user's *identity*, not a build setting. `@demo` on TikTok, `@demo` on
 * Instagram and `facebook.com/demo` are three different people with three different
 * profile pictures, so the handle alone does not identify an account — the
 * (platform, handle) pair does.
 *
 * The values must match the server's `lib/services/platforms.js` exactly:
 * `normalizePlatform()` there falls back to `tiktok` for anything it does not
 * recognise, so an unknown value here would silently resolve against TikTok.
 */
object Platforms {

    const val TIKTOK = "tiktok"
    const val INSTAGRAM = "instagram"
    const val FACEBOOK = "facebook"

    /** Every platform the sign-in screen offers, in the order it shows them. */
    val ALL = listOf(TIKTOK, INSTAGRAM, FACEBOOK)

    /** The platform used when nothing has been chosen or stored yet. */
    const val DEFAULT = TIKTOK

    /** True when the string names a platform this build knows. */
    fun isKnown(platform: String?): Boolean =
        platform != null && ALL.contains(platform.lowercase())

    /**
     * Coerce anything to a platform this build understands.
     *
     * Absent or unknown means TikTok — every row written before platforms existed
     * is a TikTok account, and the server treats an unknown platform the same way.
     */
    fun normalize(platform: String?): String =
        if (isKnown(platform)) platform!!.lowercase() else DEFAULT

    /** Human label for the platform, used in hints and error messages. */
    fun label(platform: String?): String = when (normalize(platform)) {
        INSTAGRAM -> "Instagram"
        FACEBOOK -> "Facebook"
        else -> "TikTok"
    }

    /**
     * The Android package for the platform's own app.
     *
     * Used to open the app (rather than a browser tab) when the user hands the
     * identity check over to the platform itself. Facebook's package is `katana`;
     * `com.facebook.lite` is the lightweight client and is handled separately.
     */
    fun androidPackage(platform: String?): String = when (normalize(platform)) {
        INSTAGRAM -> "com.instagram.android"
        FACEBOOK -> "com.facebook.katana"
        else -> "com.zhiliaoapp.musically"
    }

    /**
     * Whether this platform's identity is a bare handle rather than something that
     * has to be typed as a link.
     *
     * Facebook is the exception: a page has a vanity slug but a personal profile very
     * often only has a numeric id, and the only thing a user can reliably copy is the
     * profile URL. So Facebook accepts a pasted link as the primary input.
     */
    fun acceptsLink(platform: String?): Boolean = normalize(platform) == FACEBOOK
}