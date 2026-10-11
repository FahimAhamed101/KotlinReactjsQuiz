package com.Fahim101.tomquiz.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.Fahim101.tomquiz.R
import com.Fahim101.tomquiz.utils.SocialBoostApi

/**
 * BoostAdapter displaying horizontal row packages matching the SocialBoost app screenshots:
 * - Profile tab: 12 Followers packages (6 cash pills $2.99..$79.99 + 6 coin pills 100..20000 ⭐)
 * - Video tab: 12 Likes packages (6 cash pills $2.99..$79.99 + 6 coin pills 80..8000 ⭐)
 */
class BoostAdapter(
    private val allProducts: MutableList<SocialBoostApi.BoostProduct>,
    private val coinBalance: () -> Int,
    private val onProductSelected: (SocialBoostApi.BoostProduct) -> Unit
) : RecyclerView.Adapter<BoostAdapter.BoostRowViewHolder>() {

    enum class BoostTab { PROFILE, VIDEO }

    private var activeTab: BoostTab = BoostTab.PROFILE
    private var displayedItems = mutableListOf<SocialBoostApi.BoostProduct>()

    init {
        if (allProducts.isEmpty()) {
            allProducts.addAll(getAllStandardProducts())
        }
        refreshDisplayedItems()
    }

    class BoostRowViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val ivIcon: ImageView = view.findViewById(R.id.iv_boost_row_icon)
        val tvCount: TextView = view.findViewById(R.id.tv_boost_row_count)
        val tvDiscount: TextView = view.findViewById(R.id.tv_boost_row_discount)
        val btnCashPill: Button = view.findViewById(R.id.btn_boost_cash_pill)
        val layoutCoinPill: LinearLayout = view.findViewById(R.id.layout_boost_coin_pill)
        val tvCoinAmount: TextView = view.findViewById(R.id.tv_boost_coin_amount)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): BoostRowViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_boost_row, parent, false)
        return BoostRowViewHolder(view)
    }

    override fun getItemCount(): Int = displayedItems.size

    override fun onBindViewHolder(holder: BoostRowViewHolder, position: Int) {
        val product = displayedItems[position]
        val context = holder.itemView.context
        val isVideo = activeTab == BoostTab.VIDEO

        // Icon
        val iconColor = if (product.isCoinProduct) {
            ContextCompat.getColor(context, R.color.pill_coin_start)
        } else {
            ContextCompat.getColor(context, R.color.pill_cash_start)
        }

        if (isVideo) {
            holder.ivIcon.setImageResource(R.drawable.ic_heart)
            holder.ivIcon.setColorFilter(iconColor)
        } else {
            holder.ivIcon.setImageResource(R.drawable.ic_person)
            holder.ivIcon.setColorFilter(iconColor)
        }

        // Count e.g. +200, +400, +10
        holder.tvCount.text = "+${product.actionCount}"

        // Discount tag (e.g. 17% OFF)
        if (product.off != null && product.off > 0) {
            holder.tvDiscount.visibility = View.VISIBLE
            holder.tvDiscount.text = "${product.off}% OFF"
        } else {
            holder.tvDiscount.visibility = View.GONE
        }

        // Cash vs Coin pill
        if (product.isCoinProduct) {
            holder.btnCashPill.visibility = View.GONE
            holder.layoutCoinPill.visibility = View.VISIBLE
            holder.tvCoinAmount.text = "${product.coinsPrice ?: 0}"

            val canAfford = coinBalance() >= (product.coinsPrice ?: 0)
            holder.layoutCoinPill.alpha = if (canAfford) 1.0f else 0.75f
        } else {
            holder.btnCashPill.visibility = View.VISIBLE
            holder.layoutCoinPill.visibility = View.GONE
            holder.btnCashPill.text = product.price ?: "$2.99"
        }

        holder.itemView.setOnClickListener { onProductSelected(product) }
        holder.btnCashPill.setOnClickListener { onProductSelected(product) }
        holder.layoutCoinPill.setOnClickListener { onProductSelected(product) }
    }

    fun setTab(tab: BoostTab) {
        if (activeTab != tab) {
            activeTab = tab
            refreshDisplayedItems()
            notifyDataSetChanged()
        }
    }

    fun updateServerProducts(products: List<SocialBoostApi.BoostProduct>) {
        allProducts.clear()
        val standard = getAllStandardProducts()
        if (products.isEmpty()) {
            allProducts.addAll(standard)
        } else {
            // Match server products by type + count + isCoinProduct so real server product IDs
            // are attached for order creation, while strictly guaranteeing authentic prices.
            val serverMap = products.associateBy {
                "${it.productType}_${it.actionCount}_${it.isCoinProduct}"
            }
            val merged = standard.map { def ->
                val key = "${def.productType}_${def.actionCount}_${def.isCoinProduct}"
                val fromServer = serverMap[key]
                if (fromServer != null) {
                    SocialBoostApi.BoostProduct(
                        id = fromServer.id,
                        actionCount = def.actionCount,
                        coinsPrice = if (def.isCoinProduct) (def.coinsPrice ?: fromServer.coinsPrice) else null,
                        price = if (!def.isCoinProduct) (def.price ?: fromServer.price) else null,
                        billingProductId = fromServer.billingProductId ?: def.billingProductId,
                        productType = def.productType,
                        off = def.off ?: fromServer.off
                    )
                } else {
                    def
                }
            }
            allProducts.addAll(merged)
        }
        refreshDisplayedItems()
        notifyDataSetChanged()
    }

    fun refreshAffordability() {
        notifyDataSetChanged()
    }

    private fun refreshDisplayedItems() {
        val isVideo = activeTab == BoostTab.VIDEO
        val fallback = getFallbackProducts(isVideo)
        val filtered = allProducts.filter {
            val type = it.productType ?: ""
            if (isVideo) type.contains("Like", ignoreCase = true)
            else type.contains("Follow", ignoreCase = true)
        }

        displayedItems.clear()
        val cashItems = filtered.filter { !it.isCoinProduct }.sortedBy { it.actionCount }
        val coinItems = filtered.filter { it.isCoinProduct }.sortedBy { it.actionCount }

        // Guarantee all 6 cash and all 6 coin products are present in authentic ascending order
        val finalCash = if (cashItems.size == 6) cashItems else fallback.filter { !it.isCoinProduct }
        val finalCoin = if (coinItems.size == 6) coinItems else fallback.filter { it.isCoinProduct }

        displayedItems.addAll(finalCash)
        displayedItems.addAll(finalCoin)
    }

    companion object {
        fun getAllStandardProducts(): List<SocialBoostApi.BoostProduct> {
            return getFallbackProducts(false) + getFallbackProducts(true)
        }

        fun getFallbackProducts(isVideo: Boolean): List<SocialBoostApi.BoostProduct> {
            return if (!isVideo) {
                listOf(
                    // Followers Cash packages
                    SocialBoostApi.BoostProduct(1001, 200, null, "$2.99", "tt_follow_200", "Followers", null),
                    SocialBoostApi.BoostProduct(1002, 400, null, "$4.99", "tt_follow_400", "Followers", 17),
                    SocialBoostApi.BoostProduct(1003, 900, null, "$9.99", "tt_follow_900", "Followers", 26),
                    SocialBoostApi.BoostProduct(1004, 2000, null, "$19.99", "tt_follow_2000", "Followers", 33),
                    SocialBoostApi.BoostProduct(1005, 4300, null, "$39.99", "tt_follow_4300", "Followers", 38),
                    SocialBoostApi.BoostProduct(1006, 9000, null, "$79.99", "tt_follow_9000", "Followers", 44),
                    // Followers Coin packages
                    SocialBoostApi.BoostProduct(1007, 10, 100, null, null, "Followers", null),
                    SocialBoostApi.BoostProduct(1008, 30, 300, null, null, "Followers", null),
                    SocialBoostApi.BoostProduct(1009, 100, 1000, null, null, "Followers", null),
                    SocialBoostApi.BoostProduct(1010, 300, 3000, null, null, "Followers", null),
                    SocialBoostApi.BoostProduct(1011, 1000, 10000, null, null, "Followers", null),
                    SocialBoostApi.BoostProduct(1012, 2000, 20000, null, null, "Followers", null)
                )
            } else {
                listOf(
                    // Likes Cash packages
                    SocialBoostApi.BoostProduct(2001, 300, null, "$2.99", "tt_like_300", "Likes", null),
                    SocialBoostApi.BoostProduct(2002, 600, null, "$4.99", "tt_like_600", "Likes", 17),
                    SocialBoostApi.BoostProduct(2003, 1300, null, "$9.99", "tt_like_1300", "Likes", 25),
                    SocialBoostApi.BoostProduct(2004, 2700, null, "$19.99", "tt_like_2700", "Likes", 29),
                    SocialBoostApi.BoostProduct(2005, 5600, null, "$39.99", "tt_like_5600", "Likes", 33),
                    SocialBoostApi.BoostProduct(2006, 11500, null, "$79.99", "tt_like_11500", "Likes", 39),
                    // Likes Coin packages
                    SocialBoostApi.BoostProduct(2007, 10, 80, null, null, "Likes", null),
                    SocialBoostApi.BoostProduct(2008, 30, 240, null, null, "Likes", null),
                    SocialBoostApi.BoostProduct(2009, 100, 800, null, null, "Likes", null),
                    SocialBoostApi.BoostProduct(2010, 200, 1600, null, null, "Likes", null),
                    SocialBoostApi.BoostProduct(2011, 500, 4000, null, null, "Likes", null),
                    SocialBoostApi.BoostProduct(2012, 1000, 8000, null, null, "Likes", null)
                )
            }
        }
    }
}
