# Play Console pricing checklist — `com.Fahim101.tomquiz`

47 products total: **29 one-time boost packs**, **17 one-time code products**, **1 subscription**.

Where to create them:

| Kind                     | Play Console path                                             |
| ------------------------ | ------------------------------------------------------------- |
| One-time (boost + codes) | **Monetise → Products → In-app products → Create product**    |
| Subscription             | **Monetise → Products → Subscriptions → Create subscription** |

### Two levels on the one-time product form

Play splits this into two steps with **different character rules** — the single most confusing  
part of the setup:

| Step                        | Field                  | Allowed                             | What to enter                               |
| --------------------------- | ---------------------- | ----------------------------------- | ------------------------------------------- |
| 1. Product details          | **Product ID**         | lowercase, digits, `_`, `.`         | the ID from this file, e.g. `tt_follow_200` |
| 2. Availability and pricing | **Purchase option ID** | lowercase, digits, **hyphens only** | `buy`                                       |

Underscores are valid in **Product ID** and rejected in **Purchase option ID** — that is the  
only reason a pasted product ID gets refused on step 2. Use **`buy`** for all 29 one-time  
products. Purchase type stays **Buy**, Tags empty. Users never see it and the app does not  
reference it — it reads the price and offer token from the product.

Then **Set price** → base country US → the USD amount → **Activate**. A product left in Draft or  
Inactive never resolves, and the Store row silently falls back to the server price.

> `tt_follow_200` was once reported by Play as *"This Product ID has been deleted."* — a deleted  
> ID cannot be reused. If it is still refused, that one SKU needs a fresh ID; every other row  
> below is unaffected.

---

## A. Boost packs — one-time products (29)

### Followers (6)

- [ ] `tt_follow_200` — **200 Followers** — **$2.99**  
  Adds 200 followers to your TikTok profile.
- [ ] `tt_follow_400` — **400 Followers** — **$4.99**  
  Adds 400 followers to your TikTok profile.
- [ ] `tt_follow_900` — **900 Followers** — **$9.99**  
  Adds 900 followers to your TikTok profile.
- [ ] `tt_follow_2000` — **2,000 Followers** — **$19.99**  
  Adds 2,000 followers to your TikTok profile.
- [ ] `tt_follow_4300` — **4,300 Followers** — **$39.99**  
  Adds 4,300 followers to your TikTok profile.
- [ ] `tt_follow_9000` — **9,000 Followers** — **$79.99**  
  Adds 9,000 followers to your TikTok profile.

### Likes (6)

- [ ] `tt_like_300` — **300 Likes** — **$2.99**  
  Adds 300 likes to one TikTok video.
- [ ] `tt_like_600` — **600 Likes** — **$4.99**  
  Adds 600 likes to one TikTok video.
- [ ] `tt_like_1300` — **1,300 Likes** — **$9.99**  
  Adds 1,300 likes to one TikTok video.
- [ ] `tt_like_2700` — **2,700 Likes** — **$19.99**  
  Adds 2,700 likes to one TikTok video.
- [ ] `tt_like_5600` — **5,600 Likes** — **$39.99**  
  Adds 5,600 likes to one TikTok video.
- [ ] `tt_like_11500` — **11,500 Likes** — **$79.99**  
  Adds 11,500 likes to one TikTok video.

### Views (5)

- [ ] `tt_view_1000` — **1,000 Views** — **$2.99**  
  Adds 1,000 views to one TikTok video.
- [ ] `tt_view_3000` — **3,000 Views** — **$7.99**  
  Adds 3,000 views to one TikTok video.
- [ ] `tt_view_10000` — **10,000 Views** — **$19.99**  
  Adds 10,000 views to one TikTok video.
- [ ] `tt_view_25000` — **25,000 Views** — **$39.99**  
  Adds 25,000 views to one TikTok video.
- [ ] `tt_view_50000` — **50,000 Views** — **$79.99**  
  Adds 50,000 views to one TikTok video.

### Shares (5)

- [ ] `tt_share_300` — **300 Shares** — **$2.99**  
  Adds 300 shares to one TikTok video.
- [ ] `tt_share_1000` — **1,000 Shares** — **$7.99**  
  Adds 1,000 shares to one TikTok video.
- [ ] `tt_share_3000` — **3,000 Shares** — **$19.99**  
  Adds 3,000 shares to one TikTok video.
- [ ] `tt_share_8000` — **8,000 Shares** — **$39.99**  
  Adds 8,000 shares to one TikTok video.
- [ ] `tt_share_15000` — **15,000 Shares** — **$79.99**  
  Adds 15,000 shares to one TikTok video.

### Comments (5)

- [ ] `tt_comment_200` — **200 Comments** — **$2.99**  
  Adds 200 comments to one TikTok video.
- [ ] tt_comment_600 — **600 Comments** — **$7.99**  
  Adds 600 comments to one TikTok video.
- [ ] `tt_comment_1500` — **1,500 Comments** — **$19.99**  
  Adds 1,500 comments to one TikTok video.
- [ ] `tt_comment_3500` — **3,500 Comments** — **$39.99**  
  Adds 3,500 comments to one TikTok video.
- [ ] `tt_comment_7000` — **7,000 Comments** — **$79.99**  
  Adds 7,000 comments to one TikTok video.

### Coins (2)

- [ ] `tt_coin_19_99` — **17,000 Coins** — **$19.99**  
  Adds 17,000 coins to your SocialBoost balance.
- [ ] `tt_coin_99_99` — **50,000 Coins** — **$49.99**  
  Adds 50,000 coins to your SocialBoost balance.

> The ID says `99_99` but the price is \*\*$49.99\** — the ID is only a label and cannot be  
> changed, so enter $49.99.

---

## B. Code products — one-time products (17)

Same two steps, same `buy` purchase option.

- [ ] `code_food_multivendor` — **Food Multivendor App** — **$18.99**  
  Multivendor restaurant app source code with location-based ordering and Stripe checkout.
- [ ] `code_neibrly_flutter` — **Neibrly Flutter App** — **$21.99**  
  Flutter neighbourhood app source code, ready to build and publish.
- [ ] `code_macbook_store` — **MacBook Store App** — **$14.99**  
  E-commerce storefront source code with product catalogue and cart.
- [ ] `code_book_shop` — **Book Shop App** — **$11.99**  
  Book shop app source code with browsing, cart and checkout.
- [ ] `code_crud_project` — **CRUD Project** — **$6.99**  
  Full CRUD application source code with a clean, documented API layer.
- [ ] `code_flutter_ecommerce` — **Flutter Ecommerce** — **$19.99**  
  Complete Flutter e-commerce app source code with payments.
- [ ] `code_flutter_news` — **Flutter News App** — **$8.99**  
  News reader app source code with categories and article view.
- [ ] `code_kotlin_quiz` — **Kotlin Quiz App** — **$12.99**  
  Kotlin quiz app source code with scoring and multiple categories.
- [ ] `code_kotlin_shop` — **Kotlin Shop App** — **$24.99**  
  Kotlin shopping app source code with catalogue, cart and checkout.
- [ ] `code_laravel_ecommerce` — **Laravel Ecommerce** — **$16.99**  
  Laravel e-commerce backend and storefront source code.
- [ ] `code_laravel_news` — **Laravel News Portal** — **$11.99**  
  Laravel news portal source code with admin panel.
- [ ] `code_lebaba_ecommerce` — **Lebaba Ecommerce** — **$15.99**  
  E-commerce application source code with product and order management.
- [ ] `code_greatcart_django` — **GreatCart Django** — **$13.99**  
  Django e-commerce source code with cart and order flow.
- [ ] `code_upfront_multivendor` — **Upfront Multivendor** — **$22.99**  
  Multivendor marketplace source code with vendor dashboards.
- [ ] `code_mern_ecommerce` — **MERN Ecommerce** — **$17.99**  
  MERN stack e-commerce source code with authentication and cart.
- [ ] `code_react_chat` — **React Chat App** — **$9.99**  
  Real-time chat application source code built with React.
- [ ] `code_nextjs_portfolio` — **Next.js Portfolio** — **$7.99**  
  Next.js portfolio site source code, ready to deploy.

---

## C. Subscription (1)

- [ ] `codes_access_5usd_monthly` — **Code Access Monthly** — **$5.00 / month**  
  Monthly access to the source-code catalogue.

Create it under **Subscriptions**, not In-app products. Then add a **base plan**: Base plan ID  
`monthly`, billing period **Monthly**, price **$5.00**, **Active**, Purchase option ID  
`monthly-auto`. A subscription with no active base plan cannot be purchased even if the product  
itself exists.

---

## D. After creating everything

1. **Setup → License testing** → add the Gmail accounts that will test purchases.
2. Upload a **release** AAB to **Testing → Internal testing** (a debug APK will not resolve Play  
   prices — it must be installed from Play).
3. Install from the tester link, open **Store**, and check a pill shows Play's price.  
   Fastest proof: temporarily set `tt_follow_400` to \*\*$5.49\*\*. If the row still shows $4.99,  
   the SKU is not resolving; if it shows $5.49, Play is live.

## E. Coin-only packs — do NOT create these in Play

These 27 exist in the app but are bought with earned coins, so they have no Play product:

- Followers coins: 10/30/100/300/1,000/2,000 followers for 100/300/1,000/3,000/10,000/20,000 coins
- Likes coins: 10/30/100/200/500/1,000 likes for 80/240/800/1,600/4,000/8,000 coins
- Views coins: 10/30/100/300/1,000 views for 30/90/300/900/3,000 coins
- Shares coins: 10/30/100/300/1,000 shares for 80/240/800/2,400/8,000 coins
- Comments coins: 10/30/100/300/1,000 comments for 150/450/1,500/4,500/15,000 coins
