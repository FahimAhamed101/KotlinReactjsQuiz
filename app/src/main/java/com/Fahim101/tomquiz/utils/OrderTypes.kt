package com.Fahim101.tomquiz.utils

import com.Fahim101.tomquiz.R

/**
 * The order types offered on the New order screen, in the reference app's order:
 * Likes, Shares, Comments, Followers, Views.
 *
 * [available] is the honest marker for "this backend can actually deliver it".
 *
 * All five are now deliverable. Followers is verified against the target profile's follower
 * count; Likes, Shares, Comments and Views are all anchored to a single post and verified
 * against that post's own counter (`digg_count` / `share_count` / `comment_count` /
 * `play_count`), snapshotted before the task and compared after it.
 *
 * The server refuses to pay for an action whose counter its provider cannot read, so a
 * network that does not expose (say) a share count makes that task uncompletable rather than
 * free — which is why the "Soon" badge existed in the first place.
 */
enum class OrderType(
    val label: String,
    val iconRes: Int,
    val available: Boolean,
    /** True when the type is anchored to one post rather than the whole profile. */
    val needsVideoTarget: Boolean,
    /**
     * The action word the API uses: like | view | share | comment | follow.
     *
     * Also the key in a post preview's `orderable` list. A network that does not report a
     * counter cannot have that action verified, so the server refuses to pay for it — and
     * the order screen must not offer it for that particular video.
     */
    val actionKey: String,
) {
    LIKES("Likes", R.drawable.ic_heart, available = true, needsVideoTarget = true, actionKey = "like"),
    SHARES("Shares", R.drawable.ic_share, available = true, needsVideoTarget = true, actionKey = "share"),
    COMMENTS("Comments", R.drawable.ic_chat, available = true, needsVideoTarget = true, actionKey = "comment"),
    FOLLOWERS("Followers", R.drawable.ic_person_add, available = true, needsVideoTarget = false, actionKey = "follow"),
    VIEWS("Views", R.drawable.ic_eye, available = true, needsVideoTarget = true, actionKey = "view");

    /** Followers orders target the profile itself; every other type targets one post. */
    val needsProfileTarget: Boolean get() = !needsVideoTarget

    /** Singular noun for a single unit: "3 coins per view", "+100 views". */
    val noun: String get() = actionKey

    val pluralNoun: String get() = when (this) {
        FOLLOWERS -> "followers"
        else -> actionKey + "s"
    }

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
