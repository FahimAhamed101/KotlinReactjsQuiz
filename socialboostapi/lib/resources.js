// API resource serializers.
//
// Ported from App\Http\Resources\* — the JSON shapes the Android client parses.
// Field names and nesting are preserved exactly; the client switches on them.

import {
  normalizedCancelReason,
  BLOCKED_REACTIVATION_REASONS,
  REACTIVATABLE_SYSTEM_REASONS,
  isCancelledStatus,
} from './constants';
import { avatarUrlFor } from './services/avatar';

/**
 * Make a database value safe for `JSON.stringify`.
 *
 * `orders.start_count` / `expected_count` arrive as BigInt from the ported
 * services, and JSON.stringify throws "Do not know how to serialize a BigInt" on
 * them. Because the order is committed *before* the resource is serialized, that
 * throw surfaced as an `Unknown` error response — i.e. the coins were charged and
 * the client was told the order had failed. Normalise to a plain number, falling
 * back to a string only past Number.MAX_SAFE_INTEGER (where a number would lose
 * precision).
 */
function jsonSafe(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'bigint') return value;

  const max = BigInt(Number.MAX_SAFE_INTEGER);
  return value <= max && value >= -max ? Number(value) : value.toString();
}

/** ProductResource */
export function productResource(p) {
  if (!p) return null;
  return {
    id: p.id,
    action_count: p.actionCount,
    off: p.off,
    price: p.price,
    coins_price: p.coinsPrice,
    billing_product_id: p.billingProductId,
    product_type: p.productType?.name ?? null,
    created_at: p.createdAt,
  };
}

/** UserResource */
export function userResource(u) {
  if (!u) return null;
  return {
    coins: u.coins,
    id: u.id,
    created_at: u.createdAt,
  };
}

/** AccountResourceV2 — the `tiktok_info` block. */
export function accountResourceV2(a) {
  if (!a) return null;
  return {
    avatarLarger: a.avatarLarger,
    // Stable, non-expiring picture. Relative so it works from localhost and Vercel
    // alike; the client joins it onto its configured base URL. `avatarLarger` is kept
    // untouched above because it is the upstream contract.
    avatar_url: avatarUrlFor(a),
    userId: a.tiktokId,
    nickname: a.nickname,
    privateAccount: a.privateAccount,
    region: a.region,
    secUid: a.secUid,
    secret: a.secret,
    signature: a.signature,
    uniqueId: a.username,
    verified: a.verified,
    followingCount: a.following,
    followerCount: a.follower,
  };
}

/**
 * OrderResource.
 * `status` is mapped from SmmPanel back to Progress — the client has no concept
 * of the SMM handover state.
 */
export function orderResource(o, { v4 = false } = {}) {
  if (!o) return null;

  const status = o.status === 'SmmPanel' ? 'Progress' : o.status;

  const base = {
    id: o.id,
    product: productResource(o.product),
    // `orders.image` is a snapshot taken when the order was placed, and those snapshots
    // are upstream TikTok CDN URLs that expire in ~2 days — so the avatar on a task card
    // or in order history went blank a couple of days after the order. Prefer the
    // account's mirrored picture when we have one, and keep the snapshot as the fallback
    // for orders whose account row is gone.
    image: (o.account && avatarUrlFor(o.account)) || o.image,
    url: (o.url || '').toLowerCase(),
    type: o.type,
    username: o.username,
    post_id: o.postPk,
    max_progress: o.maxProgress,
    actual_max_progress: o.actualMaxProgress,
    current_progress: o.currentProgress,
    finished_at: o.finishedAt,
    created_at: o.createdAt,
    start_count: jsonSafe(o.startCount),
    expected_count: jsonSafe(o.expectedCount),
    clicks: o.clicks,
    priority: o.priority,
    reason: o.reason,
    order_id: o.orderId,
    is_likes: o.isLikes,
    admin_canceled: !!o.adminCanceled,
    is_temp: false,
    user: userResource(o.user),
    status,
  };

  if (v4) return base;

  return {
    ...base,
    can_reactivate: canReactivate(o),
    reactivated_at: o.reactivatedAt,
    reactivation_count: o.reactivationCount,
  };
}

/**
 * Mirrors Order::reactivationIneligibilityReason() — the reason the order cannot
 * be reactivated, or null when it can.
 *
 * The reason check is an **allowlist**: only the four system reasons allow
 * reactivation; anything else is refused. An earlier version of this port only
 * blocked `Admin_Canceled`, which wrongly advertised `can_reactivate: true` for
 * orders cancelled because they had been refunded — the client would then offer a
 * button the server rejects.
 */
export function reactivationIneligibilityReason(o) {
  if (!o) return 'Order not found';
  if (!isCancelledStatus(o.status)) return 'Only cancelled orders can be reactivated';
  if ((o.reactivationCount ?? 0) >= 1) return 'This order has already been reactivated once';
  if (o.adminCanceled) {
    return 'Orders cancelled by admins or backend operators cannot be reactivated';
  }

  const reason = normalizedCancelReason(o.reason);
  if (reason === null) return null;

  if (BLOCKED_REACTIVATION_REASONS.includes(reason)) {
    return `Cancellation reason '${reason}' does not allow reactivation`;
  }
  if (!REACTIVATABLE_SYSTEM_REASONS.includes(reason)) {
    return `Cancellation reason '${reason}' is not a reactivatable system reason`;
  }
  return null;
}

/** Mirrors Order::canBeReactivated(). */
export function canReactivate(o) {
  return reactivationIneligibilityReason(o) === null;
}

/** V4OfferResource */
export function offerResource(o, displayTimeMinutes = 10) {
  if (!o) return null;
  return {
    id: o.id,
    token: o.token,
    product: productResource(o.product),
    display_time_in_minutes: displayTimeMinutes,
  };
}

/** ReportResource */
export function reportResource(r) {
  if (!r) return null;
  return {
    id: r.id,
    sec_id: null,
    username: r.account?.username ?? null,
    type: r.type,
    details: r.details,
    order: r.order ? orderResource(r.order) : null,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

/** CoinsHistoryResource — a passthrough of the model's own columns. */
export function coinsHistoryResource(h) {
  if (!h) return null;
  return {
    id: h.id,
    user_id: h.userId,
    order_id: h.orderId,
    account_id: h.accountId,
    username: h.username,
    post_pk: h.postPk,
    type: h.type,
    gain: h.gain,
    lost: h.lost,
    count: h.count,
    created_at: h.createdAt,
  };
}

/**
 * CodeResource — a source-code catalogue entry.
 *
 * Only identity and price. Display metadata (images, description, USD price)
 * comes from the portfolio API, so it is not duplicated here.
 */
export function codeResource(c) {
  if (!c) return null;
  return {
    code_id: c.slug,
    title: c.title,
    coins_price: c.coinsPrice,
    is_active: c.isActive,
  };
}
