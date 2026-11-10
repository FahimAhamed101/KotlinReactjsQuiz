package com.Fahim101.tomquiz.utils

/**
 * Profile-handle parsing, shared by the sign-in screen.
 *
 * The "Already signed in" path works by having the user copy their profile link out of
 * the network's own app and reading it back off the clipboard, so the text we receive is
 * whatever the OS hands us: a full profile URL, a URL carrying tracking parameters, an
 * `@handle`, or a hand-typed handle. This object is the one place that decides what
 * counts as a handle.
 *
 * Facebook is the awkward one: a page has a vanity slug (`/facebook`) but a personal
 * profile very often only has a numeric id (`/profile.php?id=100064860875397`), and the
 * only thing a user can reliably copy is the URL. So [extractFacebook] accepts a pasted
 * link *and* returns the numeric id form when that is all there is — the server rebuilds
 * `profile.php?id=<id>` from it (see `profileUrl()` in `lib/services/platforms.js`).
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
     * Instagram's handle rule.
     *
     * Instagram allows the same characters as TikTok but caps the length at 30,
     * not 24 — and it forbids a leading or trailing dot. The server's shared
     * `tiktokUsername` validator still applies the 24-character cap, so the client
     * rejects anything longer here too rather than letting it fail as a 422 later.
     */
    val INSTAGRAM_USERNAME_RE = Regex("""^(?!.*\.$)(?!\.)[A-Za-z0-9._]{1,30}$""")

    /**
     * A Facebook page slug. Slugs are more permissive than a TikTok handle: they may
     * contain dashes and run longer, and a legacy page can contain a dot.
     */
    val FACEBOOK_SLUG_RE = Regex("""^[A-Za-z0-9._-]{2,64}$""")

    /** A numeric-only Facebook page/profile id, e.g. `100064860875397`. */
    val FACEBOOK_NUMERIC_ID_RE = Regex("""^\d{1,25}$""")

    /**
     * `https://www.tiktok.com/@handle` — the link TikTok's "Copy link" produces.
     *
     * The trailing lookahead is load-bearing: without it the greedy quantifier would
     * happily match the first 24 characters of a 25-character handle and hand back a
     * valid-looking but wrong username.
     */
    private val PROFILE_URL_RE =
        Regex("""tiktok\.com/@([A-Za-z0-9._]{2,24})(?![A-Za-z0-9._])""", RegexOption.IGNORE_CASE)

    /**
     * `https://www.instagram.com/<handle>` — the link Instagram's "Copy link" produces.
     */
    private val INSTAGRAM_PROFILE_URL_RE =
        Regex("""instagram\.com/([A-Za-z0-9._]{1,30})(?![A-Za-z0-9._/])""", RegexOption.IGNORE_CASE)

    /**
     * `facebook.com/<slug>`, `m.facebook.com/<slug>`, `fb.com/<slug>`.
     *
     * Only the path is captured, up to the first query, fragment or space, so the
     * `?ref=...&mibextid=...` tracking that the Facebook share sheet appends is dropped.
     */
    private val FACEBOOK_URL_RE =
        Regex("""(?:facebook\.com|fb\.com)/([^\s?#]*)""", RegexOption.IGNORE_CASE)

    /**
     * `profile.php?id=<id>`, or a bare `?id=<id>`.
     *
     * Checked before [FACEBOOK_URL_RE] because that path segment (`profile.php`) is
     * rejected as a reserved word, and the id is the only usable identity there.
     */
    private val FACEBOOK_ID_PARAM_RE = Regex("""[?&]id=(\d{1,25})""")

    fun isValid(handle: String): Boolean = USERNAME_RE.matches(handle)

    /** True when the handle satisfies the given platform's naming rules. */
    fun isValid(handle: String, platform: String): Boolean = when (Platforms.normalize(platform)) {
        Platforms.INSTAGRAM -> INSTAGRAM_USERNAME_RE.matches(handle)
        Platforms.FACEBOOK ->
            FACEBOOK_NUMERIC_ID_RE.matches(handle) || FACEBOOK_SLUG_RE.matches(handle)
        else -> isValid(handle)
    }

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

    /**
     * Extract an Instagram handle from copied text, or null.
     *
     * Instagram's "Copy link" gives `https://www.instagram.com/<handle>/`, so the
     * handle is the first path segment. The reserved segments (`p`, `reel`, `reels`,
     * `tv`, `explore`, `stories`, `accounts`, `direct`) are profile links to
     * something else, not to an account — returning one of those would resolve a
     * completely unrelated person.
     */
    fun extractInstagram(raw: String): String? {
        val text = raw.trim()
        if (text.isEmpty()) return null

        INSTAGRAM_PROFILE_URL_RE.find(text)?.let { match ->
            val candidate = match.groupValues[1].removeSuffix(".").removePrefix("@")
            if (isReservedInstagramSegment(candidate)) return null
            if (isValid(candidate, Platforms.INSTAGRAM)) return candidate
        }

        val bare = text.removePrefix("@").removeSuffix("/")
        if (bare.isEmpty() || bare.contains("/") || bare.contains(" ")) return null
        if (isReservedInstagramSegment(bare)) return null
        return if (isValid(bare, Platforms.INSTAGRAM)) bare else null
    }

    /**
     * Extract a Facebook page/profile identity from copied text, or null.
     *
     * Returns either a vanity slug (`facebook`) or a numeric id (`100064860875397`).
     * Both are accepted by the server, which knows how to turn either back into a
     * fetchable URL.
     *
     * Order matters:
     *  1. `?id=<digits>` first — a `profile.php?id=` link has no usable slug, and
     *     `profile.php` is itself a reserved word, so checking the path first would
     *     discard the only identity the link carries.
     *  2. `facebook.com/<slug>` next.
     *  3. A bare slug or id typed straight in.
     */
    fun extractFacebook(raw: String): String? {
        val text = raw.trim()
        if (text.isEmpty()) return null

        // A `profile.php?id=` link, or a share link carrying the id as a parameter.
        FACEBOOK_ID_PARAM_RE.find(text)?.let { return it.groupValues[1] }

        FACEBOOK_URL_RE.find(text)?.let { match ->
            val first = match.groupValues[1]
                .substringBefore('/')
                .trim()
                .removeSuffix(".")
                .removeSuffix(",")
            if (first.isNotEmpty() &&
                !isReservedFacebookSegment(first) &&
                isValid(first, Platforms.FACEBOOK)
            ) {
                return first.lowercase()
            }
            // The path exists but is not a profile (a post, group, reel, ...). Say so
            // rather than falling through to the bare-text branch below, which would
            // happily accept `facebook.com` itself as a slug.
            return null
        }

        val bare = text.removePrefix("@").removeSuffix("/")
        if (bare.isEmpty() || bare.contains("/") || bare.contains(" ")) return null
        // A hostname typed without a scheme (`facebook.com`) reaches here; it is not a
        // handle, and accepting it would resolve the Facebook company page.
        val lower = bare.lowercase()
        if (lower == "facebook.com" || lower == "www.facebook.com" || lower == "fb.com") return null
        if (isReservedFacebookSegment(bare)) return null
        return if (isValid(bare, Platforms.FACEBOOK)) lower else null
    }

    /** Instagram paths that are not account handles. */
    private val INSTAGRAM_RESERVED = setOf(
        "p", "reel", "reels", "tv", "explore", "stories", "accounts", "direct",
        "about", "developer", "legal", "challenge", "changelog", "graphql"
    )

    private fun isReservedInstagramSegment(segment: String): Boolean =
        segment.lowercase() in INSTAGRAM_RESERVED

    /**
     * Facebook paths that are not a page or profile.
     *
     * Everything here is a real first path segment on facebook.com. Without this list a
     * pasted `facebook.com/groups/123` would be read as the handle `groups`, which
     * resolves to an unrelated page.
     */
    private val FACEBOOK_RESERVED = setOf(
        "profile.php", "people", "pages", "groups", "watch", "marketplace", "gaming",
        "events", "photo.php", "photo", "photos", "permalink.php", "story.php", "stories",
        "share", "sharer", "sharer.php", "login", "login.php", "logout", "help",
        "policies", "privacy", "terms", "settings", "messages", "notifications",
        "bookmark", "friends", "saved", "memories", "fundraisers", "reels", "reel",
        "videos", "video", "posts", "about", "hashtag", "search", "home.php", "p",
        "dialog", "plugins", "business", "ads", "legal", "developer", "l.php"
    )

    private fun isReservedFacebookSegment(segment: String): Boolean =
        segment.lowercase() in FACEBOOK_RESERVED
}