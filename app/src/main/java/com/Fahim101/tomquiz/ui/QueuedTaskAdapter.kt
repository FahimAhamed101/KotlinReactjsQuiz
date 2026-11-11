package com.Fahim101.tomquiz.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.Fahim101.tomquiz.R
import com.Fahim101.tomquiz.utils.Avatars
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
        val ivAvatar: ImageView = view.findViewById(R.id.iv_other_task_avatar)
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

        holder.tvHandle.text = "@${item.username}"
        // "Like" not "Likes": the row describes the single action this task asks for.
        holder.tvAction.text = if (item.isLikes) "Like" else "Follow"
        holder.tvReward.text = "+${item.rewardCoins}"

        Avatars.load(
            holder.ivAvatar,
            Avatars.candidates(item.username, item.platform, item.imageUrl),
            item.username
        )
    }

    fun submit(newItems: List<SocialBoostApi.TaskItem>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }
}
