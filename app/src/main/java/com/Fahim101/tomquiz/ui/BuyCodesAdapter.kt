package com.Fahim101.tomquiz.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.Fahim101.tomquiz.R
import com.Fahim101.tomquiz.model.CodeItem
import com.bumptech.glide.Glide

class BuyCodesAdapter(
    private var codeList: List<CodeItem>,
    private val priceProvider: (productId: String) -> String? = { null },
    private val isSubscriptionActive: () -> Boolean = { false },
    private val onItemClickListener: (CodeItem) -> Unit,
    private val onBuyCashClickListener: (CodeItem) -> Unit,
    private val onBuyCoinsClickListener: (CodeItem) -> Unit,
    private val onOpenCodeClickListener: (CodeItem) -> Unit,
    private val onImageClickListener: ((CodeItem) -> Unit)? = null
) : RecyclerView.Adapter<BuyCodesAdapter.CodeViewHolder>() {

    inner class CodeViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val tvCategory: TextView = itemView.findViewById(R.id.tv_category)
        val tvBadge: TextView = itemView.findViewById(R.id.tv_badge)
        val tvRating: TextView = itemView.findViewById(R.id.tv_rating)
        val tvBuyers: TextView = itemView.findViewById(R.id.tv_buyers)
        val cardThumbnailContainer: View = itemView.findViewById(R.id.card_thumbnail_container)
        val ivThumbnail: ImageView = itemView.findViewById(R.id.iv_project_thumbnail)
        val btnZoomThumbnail: View? = itemView.findViewById(R.id.btn_zoom_thumbnail)
        val tvTitle: TextView = itemView.findViewById(R.id.tv_title)
        val tvDescription: TextView = itemView.findViewById(R.id.tv_description)
        val tvFeatures: TextView = itemView.findViewById(R.id.tv_features)
        val tvSnippetPreview: TextView = itemView.findViewById(R.id.tv_snippet_preview)
        val tvPrice: TextView = itemView.findViewById(R.id.tv_price)
        val tvOriginalPrice: TextView = itemView.findViewById(R.id.tv_original_price)
        val tvDiscount: TextView = itemView.findViewById(R.id.tv_discount)
        val tvCoinPrice: TextView = itemView.findViewById(R.id.tv_coin_price)
        val tvViewDetailsHint: TextView? = itemView.findViewById(R.id.tv_view_details_hint)
        val layoutDualBuyActions: LinearLayout = itemView.findViewById(R.id.layout_dual_buy_actions)
        val btnBuyCash: Button = itemView.findViewById(R.id.btn_buy_cash)
        val btnBuyCoins: Button = itemView.findViewById(R.id.btn_buy_coins)
        val btnOwnedOrPass: Button = itemView.findViewById(R.id.btn_owned_or_pass)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): CodeViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_code_product, parent, false)
        return CodeViewHolder(view)
    }

    override fun onBindViewHolder(holder: CodeViewHolder, position: Int) {
        val item = codeList[position]
        val context = holder.itemView.context

        holder.tvCategory.text = item.category
        holder.tvBadge.text = item.badge
        holder.tvRating.text = item.rating.toString()
        holder.tvBuyers.text = "(${item.buyersCount}+)"
        holder.tvTitle.text = item.title
        holder.tvDescription.text = item.description

        // Ensure coin price is populated
        if (item.coinsPrice <= 0) {
            item.coinsPrice = calculateDefaultCoinPrice(item.price)
        }
        holder.tvCoinPrice.text = "${item.coinsPrice} Coins"

        // Load Thumbnail Banner
        if (item.imageUrl.isNotBlank()) {
            holder.cardThumbnailContainer.visibility = View.VISIBLE
            Glide.with(context)
                .load(item.imageUrl)
                .placeholder(R.drawable.bg_gradient_dark)
                .error(R.drawable.bg_gradient_dark)
                .into(holder.ivThumbnail)

            // Tapping thumbnail banner navigates directly to the Product Detail Page!
            holder.cardThumbnailContainer.setOnClickListener {
                onItemClickListener(item)
            }

            // Tapping the zoom badge opens full-screen zoom preview
            holder.btnZoomThumbnail?.setOnClickListener {
                onImageClickListener?.invoke(item) ?: onItemClickListener(item)
            }
        } else {
            holder.cardThumbnailContainer.visibility = View.GONE
        }

        holder.tvFeatures.text = item.features.joinToString("\n") { "✔ $it" }
        holder.tvSnippetPreview.text =
            item.sampleSnippet.lines().firstOrNull { it.isNotBlank() } ?: "// Source code repository included"

        val livePrice = priceProvider(item.productId)
        holder.tvPrice.text = livePrice ?: item.price
        holder.tvOriginalPrice.text = item.originalPrice
        holder.tvDiscount.text = item.discount

        val hasSubscription = isSubscriptionActive()

        if (item.isPurchased) {
            holder.layoutDualBuyActions.visibility = View.GONE
            holder.btnOwnedOrPass.visibility = View.VISIBLE
            holder.btnOwnedOrPass.text = "Open Code & GitHub 🚀"
            holder.btnOwnedOrPass.setOnClickListener { onOpenCodeClickListener(item) }
        } else if (hasSubscription) {
            holder.layoutDualBuyActions.visibility = View.GONE
            holder.btnOwnedOrPass.visibility = View.VISIBLE
            holder.btnOwnedOrPass.text = "Open with All-Access Pass 👑"
            holder.btnOwnedOrPass.setOnClickListener { onOpenCodeClickListener(item) }
        } else {
            holder.layoutDualBuyActions.visibility = View.VISIBLE
            holder.btnOwnedOrPass.visibility = View.GONE

            holder.btnBuyCash.text = "Buy ${livePrice ?: item.price} 💳"
            holder.btnBuyCash.setOnClickListener { onBuyCashClickListener(item) }

            holder.btnBuyCoins.text = "Unlock ${item.coinsPrice} 🪙"
            holder.btnBuyCoins.setOnClickListener { onBuyCoinsClickListener(item) }
        }

        // Tapping anywhere on the card opens the full Product Detail Page!
        holder.itemView.setOnClickListener { onItemClickListener(item) }
        holder.tvTitle.setOnClickListener { onItemClickListener(item) }
        holder.tvDescription.setOnClickListener { onItemClickListener(item) }
        holder.tvFeatures.setOnClickListener { onItemClickListener(item) }
        holder.tvSnippetPreview.setOnClickListener { onItemClickListener(item) }
        holder.tvViewDetailsHint?.setOnClickListener { onItemClickListener(item) }
    }

    override fun getItemCount(): Int = codeList.size

    fun updateList(newList: List<CodeItem>) {
        codeList = newList
        notifyDataSetChanged()
    }

    fun refreshPrices() {
        notifyDataSetChanged()
    }

    private fun calculateDefaultCoinPrice(priceStr: String): Int {
        val num = priceStr.filter { it.isDigit() || it == '.' }.toDoubleOrNull() ?: 12.0
        return (num * 35).toInt().coerceIn(300, 1500)
    }
}
