package com.Fahim101.tomquiz.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.Fahim101.tomquiz.R
import com.Fahim101.tomquiz.utils.Avatars
import com.Fahim101.tomquiz.utils.SocialBoostApi

/** The order history list on the More screen. */
class OrderHistoryAdapter(
    private val items: MutableList<SocialBoostApi.OrderHistoryItem>
) : RecyclerView.Adapter<OrderHistoryAdapter.OrderViewHolder>() {

    class OrderViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val ivAvatar: ImageView = view.findViewById(R.id.iv_order_avatar)
        val tvType: TextView = view.findViewById(R.id.tv_order_type)
        val tvStatus: TextView = view.findViewById(R.id.tv_order_status)
        val tvUsername: TextView = view.findViewById(R.id.tv_order_username)
        val tvDate: TextView = view.findViewById(R.id.tv_order_date)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): OrderViewHolder =
        OrderViewHolder(
            LayoutInflater.from(parent.context)
                .inflate(R.layout.item_order_history, parent, false)
        )

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: OrderViewHolder, position: Int) {
        val item = items[position]
        val context = holder.itemView.context

        // Prefer the server's product type; fall back to the is_likes flag.
        val kind = item.productType ?: if (item.isLikes) "Likes" else "Followers"
        holder.tvType.text = if (item.actionCount > 0) "$kind x${item.actionCount}" else kind
        holder.tvUsername.text = "@${item.username}"
        holder.tvDate.text = item.createdAt.take(10)

        // Mirror URL first, then the order's own snapshot. The snapshot is a signed TikTok
        // CDN link and stops working after ~2 days, so it is only a fallback.
        Avatars.load(holder.ivAvatar, Avatars.candidates(item.username, item.image), item.username)

        holder.tvStatus.text = item.status
        holder.tvStatus.setTextColor(
            ContextCompat.getColor(
                context,
                when (item.status) {
                    "Completed" -> R.color.tt_teal
                    "Progress", "InQueue", "SmmPanel" -> R.color.tt_gold
                    // The server writes "Cancelled" (Laravel's spelling). "Canceled"
                    // is kept for rows created before that was aligned.
                    "Cancelled", "Canceled", "Deleted" -> R.color.tt_tip_red
                    else -> R.color.tt_text_secondary
                }
            )
        )
    }

    fun submit(newItems: List<SocialBoostApi.OrderHistoryItem>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }
}
