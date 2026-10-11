package com.Fahim101.tomquiz.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.Fahim101.tomquiz.R
import com.Fahim101.tomquiz.utils.SocialBoostApi

/**
 * The coins ledger on the More screen.
 *
 * Each row shows the net movement, so a CodeUnlock spend is visible as a
 * negative amount rather than the coins just appearing to vanish.
 */
class CoinHistoryAdapter(
    private val items: MutableList<SocialBoostApi.CoinHistoryItem>
) : RecyclerView.Adapter<CoinHistoryAdapter.CoinViewHolder>() {

    class CoinViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val tvType: TextView = view.findViewById(R.id.tv_coin_type)
        val tvMeta: TextView = view.findViewById(R.id.tv_coin_meta)
        val tvAmount: TextView = view.findViewById(R.id.tv_coin_amount)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): CoinViewHolder =
        CoinViewHolder(
            LayoutInflater.from(parent.context)
                .inflate(R.layout.item_coin_history, parent, false)
        )

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: CoinViewHolder, position: Int) {
        val item = items[position]
        val context = holder.itemView.context

        holder.tvType.text = labelFor(item.type)

        val meta = listOfNotNull(
            item.username?.let { "@$it" },
            item.createdAt.takeIf { it.length >= 10 }?.take(10)
        ).joinToString(" · ")
        holder.tvMeta.text = meta
        holder.tvMeta.visibility = if (meta.isBlank()) View.GONE else View.VISIBLE

        val net = item.gain - item.lost
        holder.tvAmount.text = if (net >= 0) "+$net" else net.toString()
        holder.tvAmount.setTextColor(
            ContextCompat.getColor(context, if (net >= 0) R.color.tt_teal else R.color.tt_tip_red)
        )
    }

    /** Turn the ledger's enum case name into something a user can read. */
    private fun labelFor(type: String): String = when (type) {
        "FollowTask" -> "Follow reward"
        "LikeTask" -> "Like reward"
        "Bonus" -> "Welcome bonus"
        "Referral" -> "Referral bonus"
        "CodeUnlock" -> "Code unlocked"
        "FollowersOrder" -> "Followers order"
        "LikesOrder" -> "Likes order"
        "CoinsOrder" -> "Coins purchase"
        "Unfollow" -> "Unfollow penalty"
        "Spin" -> "Spin reward"
        else -> type
    }

    fun submit(newItems: List<SocialBoostApi.CoinHistoryItem>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }
}
