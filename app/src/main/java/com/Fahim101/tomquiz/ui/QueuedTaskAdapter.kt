package com.Fahim101.tomquiz.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.Fahim101.tomquiz.R
import com.Fahim101.tomquiz.utils.SocialBoostApi

/**
 * The tasks still waiting in the feed, shown under "Other tasks".
 *
 * These are the rows the live card will advance to. They are displayed but not tappable:
 * the account-to-task assignment, the reward and the skip accounting are all decided
 * server-side, so jumping the queue from the client would credit the wrong order. This
 * list exists to answer "what is coming", not to reorder it.
 */
class QueuedTaskAdapter(
    private val items: MutableList<SocialBoostApi.TaskItem>
) : RecyclerView.Adapter<QueuedTaskAdapter.QueuedTaskViewHolder>() {

    class QueuedTaskViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val ivGlyph: ImageView = view.findViewById(R.id.iv_other_task_glyph)
        val tvHandle: TextView = view.findViewById(R.id.tv_other_task_handle)
        val tvAction: TextView = view.findViewById(R.id.tv_other_task_action)
        val tvReward: TextView = view.findViewById(R.id.tv_other_task_reward)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): QueuedTaskViewHolder =
        QueuedTaskViewHolder(
            LayoutInflater.from(parent.context)
                .inflate(R.layout.item_task_row, parent, false)
        )

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: QueuedTaskViewHolder, position: Int) {
        val item = items[position]

        // "Like" not "Likes": the row describes the single action this task asks for. The label
        // comes from the row's actionType, not from `isLikes` — that boolean only says "this
        // task is anchored to a post", which is equally true of share, comment and view
        // tasks, so a views task used to be queued as "Like".
        holder.tvAction.text = item.actionLabel
        holder.tvHandle.text = "@${item.username}"
        // Just the figure. The coin mark beside it already says what the number is, and the
        // "+" it used to carry read as a running total rather than a one-off payout.
        holder.tvReward.text = item.rewardCoins.toString()

        // The row shows the *action*, not the account's picture. Seven avatars stacked read
        // as one grey block that competes with the live card above; an action glyph tells you
        // at a glance what each queued task will ask for.
        holder.ivGlyph.setImageResource(glyphFor(item.action))
    }

    fun submit(newItems: List<SocialBoostApi.TaskItem>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }

    /** One glyph per action, so a views row does not wear the like heart. */
    private fun glyphFor(action: String): Int = when (action) {
        "like" -> R.drawable.ic_tk_heart
        "view" -> R.drawable.ic_eye
        "share" -> R.drawable.ic_share
        "comment" -> R.drawable.ic_chat
        else -> R.drawable.ic_person_add
    }
}
