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
import com.Fahim101.tomquiz.utils.OrderType
import com.Fahim101.tomquiz.utils.SocialBoostApi
import java.text.NumberFormat
import java.util.Locale

/**
 * The Store's package list: one row per tier of the selected action, grouped by how it is paid for.
 *
 * The list is filtered by action, not by tab: Followers from the Profile tab, and Likes /
 * Views / Shares / Comments from the chips inside the Video tab. Each action has its own
 * prices in the server catalogue, and the coin-only families (Views, Shares, Comments) have
 * no card tiers at all — so the glyph, the count and the unit price all come from the
 * product rather than from a hardcoded per-tab assumption.
 *
 * Two sections rather than one flat list. Coins are earned for free on the Tasks tab and card
 * payments are real money, so a single interleaved list makes "cheapest" depend on which
 * currency you happen to be reading. A section header is only emitted when it has rows, which
 * is why a Views list shows one header and a Likes list shows two.
 */
class BoostAdapter(
    private val allProducts: MutableList<SocialBoostApi.BoostProduct>,
    private val coinBalance: () -> Int,
    private val onProductSelected: (SocialBoostApi.BoostProduct) -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    /** A row is either a pricing section header or one tier. */
    private sealed class Row {
        /** Resource ids, not text: the adapter holds no Context, and a section's wording never
         *  varies with the data — resolving it at bind time also keeps it translatable. */
        data class Section(val titleRes: Int, val noteRes: Int) : Row()
        data class Tier(val product: SocialBoostApi.BoostProduct) : Row()
    }

    private var rows = mutableListOf<Row>()

    init {
        if (allProducts.isEmpty()) {
            allProducts.addAll(getAllStandardProducts())
        }
        refreshDisplayedItems()
    }

    inner class BoostRowViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val ivIcon: ImageView = view.findViewById(R.id.iv_boost_row_icon)
        val tvCount: TextView = view.findViewById(R.id.tv_boost_row_count)
        val tvMeta: TextView = view.findViewById(R.id.tv_boost_row_meta)
        val tvDiscount: TextView = view.findViewById(R.id.tv_boost_row_discount)
        val btnCashPill: Button = view.findViewById(R.id.btn_boost_cash_pill)
        val layoutCoinPill: LinearLayout = view.findViewById(R.id.layout_boost_coin_pill)
        val tvCoinAmount: TextView = view.findViewById(R.id.tv_boost_coin_amount)
        val tvUsd: TextView = view.findViewById(R.id.tv_boost_row_usd)
    }

    private class SectionViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val tvTitle: TextView = view.findViewById(R.id.tv_boost_section_title)
        val tvNote: TextView = view.findViewById(R.id.tv_boost_section_note)
    }

    override fun getItemViewType(position: Int): Int =
        if (rows[position] is Row.Section) TYPE_SECTION else TYPE_TIER

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        val inflater = LayoutInflater.from(parent.context)
        return if (viewType == TYPE_SECTION) {
            SectionViewHolder(inflater.inflate(R.layout.item_boost_section, parent, false))
        } else {
            BoostRowViewHolder(inflater.inflate(R.layout.item_boost_row, parent, false))
        }
    }

    override fun getItemCount(): Int = rows.size

    /** Number of real tiers on screen — section headers are not packages. */
    val tierCount: Int get() = rows.count { it is Row.Tier }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        when (val row = rows[position]) {
            is Row.Section -> {
                val vh = holder as SectionViewHolder
                vh.tvTitle.setText(row.titleRes)
                vh.tvNote.setText(row.noteRes)
            }
            is Row.Tier -> bindTier(holder as BoostRowViewHolder, row.product)
        }
    }

    private fun bindTier(holder: BoostRowViewHolder, product: SocialBoostApi.BoostProduct) {
        val context = holder.itemView.context
        val type = OrderType.fromProductType(product.productType)
        val noun = type?.noun ?: "unit"

        val iconColor = if (product.isCoinProduct) {
            ContextCompat.getColor(context, R.color.pill_coin_start)
        } else {
            ContextCompat.getColor(context, R.color.pill_cash_start)
        }
        holder.ivIcon.setImageResource(iconFor(product.productType ?: selectedTypeLabel))
        holder.ivIcon.setColorFilter(iconColor)

        // "+100 views" — the count plus the action it buys. A bare "+100" in a list of five
        // actions says nothing about what the buyer is paying for.
        holder.tvCount.text = "+" + NumberFormat.getIntegerInstance().format(product.actionCount) +
            " " + (type?.pluralNoun ?: "")

        if (product.off != null && product.off > 0) {
            holder.tvDiscount.visibility = View.VISIBLE
            holder.tvDiscount.text = "${product.off}% OFF"
        } else {
            holder.tvDiscount.visibility = View.GONE
        }

        if (product.isCoinProduct) {
            val price = product.coinsPrice ?: 0
            holder.btnCashPill.visibility = View.GONE
            holder.layoutCoinPill.visibility = View.VISIBLE
            holder.tvCoinAmount.text = NumberFormat.getIntegerInstance().format(price)
            holder.layoutCoinPill.alpha = 1f

            // Its money value. Views, Shares and Comments have no card SKU, so without this
            // the video packages carry no currency figure at all — and "300" beside "$2.99"
            // is not a choice a buyer can make.
            val usd = usdForCoins(allProducts, price)
            if (usd == null) {
                holder.tvUsd.visibility = View.GONE
            } else {
                holder.tvUsd.text = context.getString(R.string.tt_boost_usd_approx, usd)
                holder.tvUsd.visibility = View.VISIBLE
            }

            val canAfford = coinBalance() >= price
            // The meta line answers the only question that matters before tapping: can I take
            // this one now, and if not, how short am I? Dimming the row says "no" without
            // saying "how far", which was the previous behaviour.
            holder.tvMeta.text = if (canAfford) {
                context.getString(
                    R.string.tt_boost_meta_coins,
                    formatNumber(price.toDouble() / product.actionCount.coerceAtLeast(1)),
                    noun,
                )
            } else {
                context.getString(
                    R.string.tt_boost_short_by,
                    NumberFormat.getIntegerInstance().format(price - coinBalance()),
                )
            }
            holder.tvMeta.setTextColor(
                ContextCompat.getColor(
                    context,
                    if (canAfford) R.color.tt_text_secondary else R.color.tt_tip_red,
                )
            )
            holder.itemView.alpha = if (canAfford) 1f else 0.62f
        } else {
            holder.btnCashPill.visibility = View.VISIBLE
            holder.layoutCoinPill.visibility = View.GONE
            holder.btnCashPill.text = product.price ?: "—"

            // A card tier already states money, so the coin value line must go. Holders are
            // recycled: leaving it alone kept the *previous* row's "≈ $0.24" under "$2.99",
            // which reads as a second, contradictory price for the same pack.
            holder.tvUsd.visibility = View.GONE

            val perUnit = cashPerUnit(product.price, product.actionCount)
            holder.tvMeta.text = if (perUnit == null) {
                ""
            } else {
                context.getString(R.string.tt_boost_meta_cash, perUnit, noun)
            }
            holder.tvMeta.setTextColor(ContextCompat.getColor(context, R.color.tt_text_secondary))
            holder.itemView.alpha = 1f
        }

        holder.itemView.setOnClickListener { onProductSelected(product) }
        holder.btnCashPill.setOnClickListener { onProductSelected(product) }
        holder.layoutCoinPill.setOnClickListener { onProductSelected(product) }
    }

    /**
     * Which order type's packages are shown: "Likes", "Shares", "Comments", "Followers",
     * "Views".
     *
     * The type label is what the catalogue is keyed by. It replaced a binary
     * likes-vs-followers flag, which displayed *Followers* packages under a Shares heading
     * and would have charged for the wrong product.
     */
    private var selectedTypeLabel: String? = "Likes"

    fun setSelectedType(label: String) {
        if (selectedTypeLabel != label) {
            selectedTypeLabel = label
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

            // Server-only products (Shares, Comments, Views) have no counterpart in the
            // hardcoded list, so they must be appended or those families would come up empty
            // and their real product ids — the ones the order has to reference — would be lost.
            val known = merged.map { "${it.productType}_${it.actionCount}_${it.isCoinProduct}" }.toSet()
            allProducts.addAll(
                products.filter { "${it.productType}_${it.actionCount}_${it.isCoinProduct}" !in known }
            )
        }
        refreshDisplayedItems()
        notifyDataSetChanged()
    }

    fun refreshAffordability() {
        notifyDataSetChanged()
    }

    private fun refreshDisplayedItems() {
        // Also called from the constructor's init block, which runs BEFORE the property
        // initialisers below it in source order — so this field is still null on that first
        // call. Reading it unguarded crashed the app on launch.
        val label = selectedTypeLabel ?: "Likes"
        val filtered = allProducts.filter {
            (it.productType ?: "").contains(label, ignoreCase = true)
        }

        rows = mutableListOf()

        // The hardcoded fallback catalogue only covers Followers and Likes, so only those
        // two may borrow it. For any other type the server's catalogue is the only truth,
        // and an empty list has to stay empty: falling back would put *Followers* packages
        // under a Views heading, which is exactly how a buyer pays for the wrong thing. The
        // screen says "no packages" instead (HomeActivity.refreshBoostPackageState).
        val catalogue = when {
            filtered.isNotEmpty() -> filtered
            hasFallbackCatalogue(label) -> getFallbackProducts(isVideoType(label))
            else -> emptyList()
        }

        // Card tiers first — that is the reference app's layout and the order the packs were
        // always shown in — then the free ones, each section ascending by size.
        val card = catalogue.filter { !it.isCoinProduct }.sortedBy { it.actionCount }
        val coins = catalogue.filter { it.isCoinProduct }.sortedBy { it.actionCount }

        if (card.isNotEmpty()) {
            rows += Row.Section(
                titleRes = R.string.tt_boost_section_card,
                noteRes = R.string.tt_boost_section_card_note,
            )
            rows += card.map { Row.Tier(it) }
        }
        if (coins.isNotEmpty()) {
            rows += Row.Section(
                titleRes = R.string.tt_boost_section_coins,
                noteRes = R.string.tt_boost_section_coins_note,
            )
            rows += coins.map { Row.Tier(it) }
        }

        notifyDataSetChanged()
    }

    companion object {
        private const val TYPE_SECTION = 0
        private const val TYPE_TIER = 1

        /** True for the two types the built-in catalogue can stand in for offline. */
        private fun hasFallbackCatalogue(label: String): Boolean =
            label.contains("follow", ignoreCase = true) || label.contains("like", ignoreCase = true)

        private fun isVideoType(label: String): Boolean =
            label.contains("like", ignoreCase = true)

        /** The glyph for a package's action, so a Views row is not wearing a heart. */
        private fun iconFor(typeLabel: String?): Int {
            val t = typeLabel?.lowercase() ?: return R.drawable.ic_person
            return when {
                t.contains("like") -> R.drawable.ic_heart
                t.contains("view") -> R.drawable.ic_eye
                t.contains("share") -> R.drawable.ic_share
                t.contains("comment") -> R.drawable.ic_chat
                else -> R.drawable.ic_person
            }
        }

        /**
         * The live catalogue's best coin pack: 50,000 coins for $49.99. Only used when the
         * Coins family has not loaded yet — see [usdForCoins].
         */
        private const val COIN_FALLBACK_RATE = 49.99 / 50000.0

        /** "$2.99" over 300 likes -> "$0.010". The figure that makes tiers comparable. */
        private fun cashPerUnit(price: String?, count: Int): String? {
            val value = price?.trim()?.removePrefix("$")?.toDoubleOrNull() ?: return null
            if (count <= 0) return null
            return money(value / count)
        }

        /**
         * What a coin price is worth in money.
         *
         * Views, Shares and Comments are coin-only — the catalogue carries no card SKU for
         * them — so "+300 views / 900 coins" had no common unit with the "$2.99" a buyer saw
         * one tab earlier, and two lists of numbers cannot be compared at all. The conversion
         * comes from the Coins family itself: the best rate on sale, meaning the cheapest
         * dollars-per-coin pack. That is a *marginal* value, not a checkout total — nobody
         * can buy exactly 900 coins, they buy a pack — which is why every use of it reads
         * "≈" (R.string.tt_boost_usd_approx).
         *
         * Falls back to [COIN_FALLBACK_RATE] when the Coins family is absent, because that is
         * the signed-out and cold-server path, and hiding the figure there would restore the
         * exact gap this exists to close.
         *
         * Public because the Store's action hint quotes the same figure for the cheapest tier
         * (HomeActivity.updateActionHint); one rate in two places has to be one rate in one
         * place, or the hint and the row will disagree.
         */
        fun usdForCoins(products: List<SocialBoostApi.BoostProduct>, coins: Int): String? {
            if (coins <= 0) return null
            val bestRate = products.asSequence()
                .filter { (it.productType ?: "").contains("coin", ignoreCase = true) }
                .filter { !it.isCoinProduct && it.actionCount > 0 }
                .mapNotNull { pack ->
                    val value = pack.price?.trim()?.removePrefix("$")?.toDoubleOrNull()
                    if (value == null || value <= 0) null else value / pack.actionCount
                }
                .minOrNull()
                ?: COIN_FALLBACK_RATE
            return money(coins * bestRate)
        }

        /**
         * "$0.009" below a cent, "$0.10" above — three decimals only while the cents would
         * round away, so a small unit price never collapses to "$0.00". The 0.095 threshold
         * rather than 0.1 is what keeps "100 coins" reading "$0.10" instead of "$0.100".
         *
         * Fixed to [Locale.US]: the symbol is a literal dollar sign, so a device set to a
         * comma-decimal locale would otherwise render "$0,010" beside the server's "$2.99".
         */
        private fun money(value: Double): String =
            String.format(Locale.US, if (value >= 0.095) "$%.2f" else "$%.3f", value)

        /** 3.0 -> "3", 3.5 -> "3.5". Coin prices divide evenly at every tier we sell. */
        private fun formatNumber(value: Double): String =
            if (value == value.toLong().toDouble()) value.toLong().toString()
            else String.format(Locale.US, "%.1f", value)

        fun getAllStandardProducts(): List<SocialBoostApi.BoostProduct> {
            return getFallbackProducts(false) + getFallbackProducts(true)
        }

        fun getFallbackProducts(isVideo: Boolean): List<SocialBoostApi.BoostProduct> {
            return if (!isVideo) {
                listOf(
                    // Followers Cash packages
                    SocialBoostApi.BoostProduct(1001, 200, null, "$2.99", "tt_follow_201", "Followers", null),
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