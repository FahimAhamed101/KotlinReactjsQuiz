package com.Fahim101.tomquiz.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.Fahim101.tomquiz.R
import com.Fahim101.tomquiz.utils.Avatars
import com.Fahim101.tomquiz.utils.SocialBoostApi

/**
 * The buyer's side of the task feed: their own orders, shown alongside the live task card
 * on the Tasks screen.
 *
 * Same data as `OrderHistoryAdapter` — these are the same `/v6/me/orders` rows — laid out
 * horizontally and compactly because this screen has to keep the current task visible too.
 * The delivered counter is drawn rather than left as an ambiguous "x100".
 */
class TaskOrderAdapter(
    private val items: MutableList<SocialBoostApi.OrderHistoryItem>
) : RecyclerView.Adapter<TaskOrderAdapter.TaskOrderViewHolder>() {

    class TaskOrderViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val ivAvatar: ImageView = view.findViewById(R.id.iv_task_order_avatar)
        val tvType: TextView = view.findViewById(R.id.tv_task_order_type)
        val tvHandle: TextView = view.findViewById(R.id.tv_task_order_handle)
        val progress: ProgressBar = view.findViewById(R.id.progress_task_order)
        val tvProgress: TextView = view.findViewById(R.id.tv_task_order_progress)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): TaskOrderViewHolder =
        TaskOrderViewHolder(
            LayoutInflater.from(parent.context)
                .inflate(R.layout.item_order_task, parent, false)
        )

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: TaskOrderViewHolder, position: Int) {
        val item = items[position]
        val context = holder.itemView.context

        val kind = item.productType ?: if (item.isLikes) "Likes" else "Followers"
        holder.tvType.text = if (item.actionCount > 0) "$kind x${item.actionCount}" else kind
        holder.tvHandle.text = "@${item.username}"

        val delivered = item.currentProgress.coerceAtLeast(0)
        val ordered = item.maxProgress
        holder.progress.max = if (ordered > 0) ordered else 1
        holder.progress.progress = delivered

        holder.tvProgress.text = if (ordered > 0) {
            "${item.currentProgress} / ${item.maxProgress} · ${item.status}"
        } else {
            item.status
        }

        holder.tvProgress.setTextColor(
            ContextCompat.getColor(
                context,
                when (item.status) {
                    "Completed" -> R.color.tt_teal
                    "Progress", "InQueue", "SmmPanel" -> R.color.tt_gold
                    "Cancelled", "Canceled", "Deleted" -> R.color.tt_tip_red
                    else -> R.color.tt_text_secondary
                }
            )
        )

        Avatars.load(holder.ivAvatar, Avatars.candidates(item.username, item.image), item.username)
    }

    fun submit(newItems: List<SocialBoostApi.OrderHistoryItem>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }
}
