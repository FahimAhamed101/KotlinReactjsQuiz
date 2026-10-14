package com.Fahim101.tomquiz.utils

/**
 * TikTok handle parsing, shared by the sign-in screen.
 *
 * The optional "Already signed in to TikTok" path works by having the user copy
 * their profile link out of TikTok and reading it back off the clipboard, so the
 * text we receive is whatever the OS hands us: a full profile URL, a URL carrying
 * tracking parameters, an `@handle`, or a hand-typed handle. This object is the one
 * place that decides what counts as a handle.
 *
 * Kept free of Android types so it can be unit-tested on the JVM.
 */
object TikTokHandle {

    /**
     * The server's own rule for a username — 2..24 characters of `[A-Za-z0-9._]`
     * with no trailing dot (`^(?!.*\.$)[a-zA-Z0-9._]+$` plus the length cap).
     * Applied locally so a bad handle fails before a round trip.
     */
    val USERNAME_RE = Regex("""^(?!.*\.$)[A-Za-z0-9._]{2,24}$""")

    /**
     * `https://www.tiktok.com/@handle` — the link TikTok's "Copy link" produces.
     *
     * The trailing lookahead is load-bearing: without it the greedy quantifier would
     * happily match the first 24 characters of a 25-character handle and hand back a
     * valid-looking but wrong username.
     */
    private val PROFILE_URL_RE =
        Regex("""tiktok\.com/@([A-Za-z0-9._]{2,24})(?![A-Za-z0-9._])""", RegexOption.IGNORE_CASE)

    fun isValid(handle: String): Boolean = USERNAME_RE.matches(handle)

    /**
     * Extract a handle from copied text, or null when the text does not contain one.
     *
     * Null is the honest answer for a `vm.tiktok.com/XXXX` short link: it carries an
     * opaque code and no username, so there is nothing to read.
     */
    fun extract(raw: String): String? {
        val text = raw.trim()
        if (text.isEmpty()) return null

        PROFILE_URL_RE.find(text)?.let { match ->
            // The character class allows a dot, so a sentence-ending "." would be
            // captured; trim it before validating.
            val fromUrl = match.groupValues[1].removeSuffix(".")
            if (isValid(fromUrl)) return fromUrl
        }

        // A bare "@handle", or a handle typed straight into the field.
        val bare = text.removePrefix("@")
        return if (isValid(bare)) bare else null
    }
}
