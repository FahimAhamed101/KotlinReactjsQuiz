package com.Fahim101.tomquiz.utils

import com.Fahim101.tomquiz.R

/**
 * The order types offered on the New order screen, in the reference app's order:
 * Likes, Shares, Comments, Followers, Views.
 *
 * [available] is the honest marker for "this backend can actually deliver it".
 * Only **Followers** and **Likes** have a delivery path. The Laravel spec (which is the
 * authority when it and the Node port disagree) stores a single `is_likes` boolean per
 * order and configures the SMM panel with exactly two service ids — `SmmLikeServiceId`
 * and `SmmFollowServiceId` — and our Mongo `Order` model mirrors that with `isLikes`.
 * There is nowhere in the stack for a shares / comments / views order to live.
 *
 * Those three tiles are still shown, because the reference app offers them and the grid
 * would look broken without them, but they carry a "Soon" badge and refuse to order.
 * Silently accepting one would take the user's coins for work nothing can perform —
 * the same failure class as the mock-purchase fallback removed in
 * `PURCHASE_FIX_REPORT.md`.
 */
enum class OrderType(
    val label: String,
    val iconRes: Int,
    val available: Boolean,
    /** True when the type is anchored to one post rather than the whole profile. */
    val needsVideoTarget: Boolean,
) {
    LIKES("Likes", R.drawable.ic_heart, available = true, needsVideoTarget = true),
    SHARES("Shares", R.drawable.ic_share, available = false, needsVideoTarget = true),
    COMMENTS("Comments", R.drawable.ic_chat, available = false, needsVideoTarget = true),
    FOLLOWERS("Followers", R.drawable.ic_person_add, available = true, needsVideoTarget = false),
    VIEWS("Views", R.drawable.ic_eye, available = false, needsVideoTarget = true);

    /** Followers orders target the profile itself; every other type targets one post. */
    val needsProfileTarget: Boolean get() = !needsVideoTarget

    companion object {
        /** The type the screen opens on. Likes is first in the reference app's grid. */
        val DEFAULT = LIKES

        /** Maps a package's `productType` (from the server, e.g. "Followers") onto a type. */
        fun fromProductType(productType: String?): OrderType? {
            val t = productType?.lowercase() ?: return null
            return values().firstOrNull { t.contains(it.label.lowercase()) }
        }
    }
}
