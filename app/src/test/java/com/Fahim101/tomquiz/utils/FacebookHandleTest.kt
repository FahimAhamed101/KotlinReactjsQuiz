package com.Fahim101.tomquiz.utils

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests for Facebook page/profile link parsing.
 *
 * Facebook identity comes in two shapes and the sign-in screen has to accept both:
 *
 *  - a vanity slug, e.g. `facebook.com/facebook` or `facebook.com/zuck`
 *  - a numeric-only id, e.g. `facebook.com/profile.php?id=100064860875397`
 *
 * The value that comes back is what gets sent to the server as the account handle, so
 * a reserved first segment (`groups`, `reel`, `photo.php`, ...) must NOT be mistaken for
 * a page name — that would resolve a completely unrelated person's profile.
 */
class FacebookHandleTest {

    // ---------------- vanity slugs ----------------

    @Test
    fun `extracts a page slug from a profile link`() {
        assertEquals("facebook", TikTokHandle.extractFacebook("https://www.facebook.com/facebook"))
    }

    @Test
    fun `extracts a personal profile slug`() {
        assertEquals("zuck", TikTokHandle.extractFacebook("https://www.facebook.com/zuck"))
    }

    @Test
    fun `drops the tracking params the share sheet appends`() {
        assertEquals(
            "zuck",
            TikTokHandle.extractFacebook("https://www.facebook.com/zuck?mibextid=abc&ref=share"),
        )
    }

    @Test
    fun `accepts the mobile and short hosts`() {
        assertEquals("zuck", TikTokHandle.extractFacebook("m.facebook.com/zuck"))
        assertEquals("zuck", TikTokHandle.extractFacebook("https://fb.com/zuck/"))
    }

    @Test
    fun `lowercases the slug`() {
        // The server keys accounts by (platform, username); a case difference must not
        // create two accounts for the same page.
        assertEquals("yourpage", TikTokHandle.extractFacebook("https://www.facebook.com/YourPage"))
    }

    @Test
    fun `accepts a slug with a dash`() {
        assertEquals("my-page", TikTokHandle.extractFacebook("https://www.facebook.com/my-page"))
    }

    // ---------------- numeric-only profile ids ----------------

    @Test
    fun `extracts a numeric id from a profile dot php link`() {
        assertEquals(
            "100064860875397",
            TikTokHandle.extractFacebook("https://www.facebook.com/profile.php?id=100064860875397"),
        )
    }

    @Test
    fun `accepts a short numeric id`() {
        // Zuckerberg's legacy id really is a single digit; do not impose a minimum length.
        assertEquals("4", TikTokHandle.extractFacebook("https://www.facebook.com/profile.php?id=4"))
    }

    @Test
    fun `accepts a bare numeric id`() {
        assertEquals("100064860875397", TikTokHandle.extractFacebook("100064860875397"))
    }

    @Test
    fun `accepts a bare slug`() {
        assertEquals("yourpage", TikTokHandle.extractFacebook("  YourPage  "))
    }

    // ---------------- paths that are not a page or profile ----------------

    @Test
    fun `rejects reserved first segments`() {
        assertNull(TikTokHandle.extractFacebook("https://www.facebook.com/groups/123456"))
        assertNull(TikTokHandle.extractFacebook("https://www.facebook.com/reel/987654"))
        assertNull(TikTokHandle.extractFacebook("https://www.facebook.com/pages/Some-Page/123"))
        assertNull(TikTokHandle.extractFacebook("https://www.facebook.com/marketplace/item/1"))
    }

    @Test
    fun `rejects a bare hostname`() {
        // Otherwise "facebook.com" itself is a syntactically valid slug and would resolve
        // to whatever page happens to own that name.
        assertNull(TikTokHandle.extractFacebook("facebook.com"))
        assertNull(TikTokHandle.extractFacebook("www.facebook.com"))
        assertNull(TikTokHandle.extractFacebook("fb.com"))
    }

    @Test
    fun `returns null for empty or unrelated text`() {
        assertNull(TikTokHandle.extractFacebook(""))
        assertNull(TikTokHandle.extractFacebook("   "))
        assertNull(TikTokHandle.extractFacebook("hello world"))
        assertNull(TikTokHandle.extractFacebook("https://instagram.com/zuck"))
    }

    // ---------------- the shared validator ----------------

    @Test
    fun `isValid accepts both facebook identity shapes`() {
        assertTrue(TikTokHandle.isValid("facebook", Platforms.FACEBOOK))
        assertTrue(TikTokHandle.isValid("my-page", Platforms.FACEBOOK))
        assertTrue(TikTokHandle.isValid("100064860875397", Platforms.FACEBOOK))
        assertTrue(TikTokHandle.isValid("4", Platforms.FACEBOOK))
    }

    @Test
    fun `isValid rejects values that are not a handle`() {
        assertFalse(TikTokHandle.isValid("has space", Platforms.FACEBOOK))
        assertFalse(TikTokHandle.isValid("a", Platforms.FACEBOOK))
        assertFalse(TikTokHandle.isValid("", Platforms.FACEBOOK))
        // A whole URL must be normalised first; it is never a valid handle by itself.
        assertFalse(TikTokHandle.isValid("https://www.facebook.com/zuck", Platforms.FACEBOOK))
    }

    @Test
    fun `platform validation stays scoped`() {
        // A dash is legal on Facebook but not on TikTok; check neither leaked into the other.
        assertFalse(TikTokHandle.isValid("my-page", Platforms.TIKTOK))
        assertFalse(TikTokHandle.isValid("my-page", Platforms.INSTAGRAM))
        assertEquals(Platforms.FACEBOOK, Platforms.normalize("Facebook"))
    }
}