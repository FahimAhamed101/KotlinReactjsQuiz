package com.Fahim101.tomquiz.utils

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests for the clipboard -> handle parsing behind the optional
 * "Already signed in to TikTok" sign-in.
 *
 * That path never asks the user to type anything: it reads whatever TikTok's
 * "Copy link" put on the clipboard and has to decide, unaided, whether the text
 * contains a usable handle. The cases below are the shapes a real clipboard
 * actually holds — including the ones where the honest answer is "no handle here".
 */
class TikTokHandleTest {

    // ---------------- the happy path: a copied profile link ----------------

    @Test
    fun `extracts the handle from a profile link`() {
        assertEquals("fahim1000011", TikTokHandle.extract("https://www.tiktok.com/@fahim1000011"))
    }

    @Test
    fun `extracts the handle when the link carries tracking parameters`() {
        // TikTok's share sheet appends query params; the regex must stop at the '?'.
        assertEquals(
            "creator_anna",
            TikTokHandle.extract("https://www.tiktok.com/@creator_anna?lang=en&is_copy_url=1"),
        )
    }

    @Test
    fun `drops a sentence-ending dot from a pasted link`() {
        // The character class allows '.', so a trailing full stop would be captured.
        assertEquals("daily_vlog_max", TikTokHandle.extract("see https://www.tiktok.com/@daily_vlog_max."))
    }

    @Test
    fun `keeps dots and underscores inside the handle`() {
        assertEquals("a.b_c9", TikTokHandle.extract("https://www.tiktok.com/@a.b_c9"))
    }

    @Test
    fun `preserves the handle's letter case`() {
        assertEquals("JohnDoe", TikTokHandle.extract("https://www.tiktok.com/@JohnDoe"))
    }

    // ---------------- handles typed rather than copied ----------------

    @Test
    fun `accepts a bare at-handle`() {
        assertEquals("fahim1000011", TikTokHandle.extract("@fahim1000011"))
    }

    @Test
    fun `accepts a plain handle`() {
        assertEquals("fahim1000011", TikTokHandle.extract("  fahim1000011  "))
    }

    // ---------------- where there is genuinely no handle ----------------

    @Test
    fun `returns null for a short link`() {
        // vm.tiktok.com/XXXX is an opaque redirect code — it contains no username.
        assertNull(TikTokHandle.extract("https://vm.tiktok.com/ZMabcdefg/"))
    }

    @Test
    fun `returns null for empty or blank text`() {
        assertNull(TikTokHandle.extract(""))
        assertNull(TikTokHandle.extract("   "))
    }

    @Test
    fun `returns null for unrelated clipboard text`() {
        assertNull(TikTokHandle.extract("hello world"))
        assertNull(TikTokHandle.extract("https://example.com/@someone"))
    }

    // ---------------- length and shape limits ----------------

    @Test
    fun `rejects a handle shorter than two characters`() {
        assertNull(TikTokHandle.extract("@a"))
        assertNull(TikTokHandle.extract("https://www.tiktok.com/@a"))
    }

    @Test
    fun `rejects a handle longer than twenty four characters`() {
        val tooLong = "a".repeat(25)
        assertNull(TikTokHandle.extract("@$tooLong"))
        assertNull(TikTokHandle.extract("https://www.tiktok.com/@$tooLong"))
    }

    @Test
    fun `rejects a bare handle ending in a dot`() {
        // Matches the server's ^(?!.*\.$)[a-zA-Z0-9._]+$ rule.
        assertNull(TikTokHandle.extract("trailing."))
    }

    // ---------------- the shared validator ----------------

    @Test
    fun `isValid agrees with the server rule`() {
        assertTrue(TikTokHandle.isValid("fahim1000011"))
        assertTrue(TikTokHandle.isValid("a.b_c9"))
        assertFalse(TikTokHandle.isValid("a"))
        assertFalse(TikTokHandle.isValid("a".repeat(25)))
        assertFalse(TikTokHandle.isValid("trailing."))
        assertFalse(TikTokHandle.isValid("has space"))
        assertFalse(TikTokHandle.isValid("has-dash"))
        assertFalse(TikTokHandle.isValid(""))
    }
}
