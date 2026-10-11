package com.Fahim101.tomquiz.model

import java.io.Serializable

data class CodeItem(
    val id: String,
    val productId: String, // Google Play In-App Managed Product ID
    val title: String,
    val category: String,
    val description: String,
    val price: String,
    val priceUsd: Double,
    /**
     * Coin price for unlocking this code from the balance.
     *
     * Comes from the SocialBoost API, never from the client. 0 means the server has
     * not published a price for this code, and the coin option stays hidden.
     */
    var coinsPrice: Int = 0,
    val originalPrice: String,
    val discount: String,
    val rating: Double,
    val buyersCount: Int,
    val badge: String,
    val features: List<String>,
    val repoUrl: String,
    val sampleSnippet: String,
    var isPurchased: Boolean = false,
    val imageUrl: String = "",
    val imageUrls: List<String> = emptyList(),
    val webLink: String = ""
) : Serializable
