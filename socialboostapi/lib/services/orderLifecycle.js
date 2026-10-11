// Order completion and queue promotion.
//
// Ported from App\Services\OrderService::completeOrder and ::promoteNextQueuedOrder,
// plus the Free-order capacity check in App\Services\FreeOrderLimitService.
//
// These live in their own module rather than in orders.js because coinsCheck.js
// also needs them, and orders.js already imports from coinsCheck.js — putting them
// in orders.js would make the two files import each other.
//
// Known gap versus Laravel: `completeOrder` there also enqueues a push
// notification via BulkNotification. This port has no notifications collection, so
// that step is omitted rather than faked. It is purely cosmetic — no order state
// or coin balance depends on it.

import db from '../db';
import { OrderStatus, OrderType, OrderCancelCode } from '../constants';
import { getInt } from '../settings';
import { getPostInfo, getProfileInfo } from './tiktok';

/** Laravel's FreeOrderLimitService::DEFAULT_LIMIT. */
const FREE_ORDER_DEFAULT_LIMIT = 500;

/**
 * How many Free orders may be in Progress at once.
 * Mirrors FreeOrderLimitService::limit() — a negative stored value falls back to
 * the default, but an explicit 0 is honoured (the admin paused free orders).
 */
export async function freeOrderLimit() {
  const value = await getInt('maxFreeOrdersInProgress', FREE_ORDER_DEFAULT_LIMIT);
  return value >= 0 ? value : FREE_ORDER_DEFAULT_LIMIT;
}

/** Free orders currently in Progress. Mirrors FreeOrderLimitService::activeFreeCount(). */
export async function activeFreeOrderCount(client = db) {
  return client.order.count({
    where: { type: OrderType.Free, status: OrderStatus.Progress, deletedAt: null },
  });
}

/** Mirrors FreeOrderLimitService::hasCapacity(). */
export async function hasFreeOrderCapacity(client = db) {
  const [limit, active] = await Promise.all([
    freeOrderLimit(),
    activeFreeOrderCount(client),
  ]);
  return active < limit;
}

/**
 * Mark an order completed.
 * Mirrors OrderService::completeOrder — idempotent, snaps `current_progress` up to
 * `actual_max_progress`, and stamps `finished_at`.
 *
 * @param {object|null} tx     an open transaction handle, or null to use the global client
 * @param {number} orderId
 * @returns {Promise<object|null>} the completed order, or null when it does not exist
 */
export async function completeOrder(tx, orderId) {
  const client = tx ?? db;

  const order = await client.order.findOne({ where: { id: orderId } });
  if (!order) return null;
  if (order.status === OrderStatus.Completed) return order;

  return client.order.update({
    where: { id: order.id },
    data: {
      status: OrderStatus.Completed,
      finishedAt: new Date(),
      // Laravel overwrites rather than increments here, so an order that somehow
      // overshot its target still reports a clean, full bar to the client.
      currentProgress: order.actualMaxProgress,
    },
  });
}

/**
 * Promote the next queued order for the same (user, url).
 * Mirrors OrderService::promoteNextQueuedOrder.
 *
 * Called whenever an order stops occupying its slot — completed or cancelled — so
 * a user who queued a second run for the same URL is not stuck behind a finished
 * one. Deliberately *not* wrapped in the caller's transaction: it makes live
 * TikTok calls, and holding a write transaction open across a network round-trip
 * would serialise every other writer.
 *
 * @returns {Promise<object|null>} the promoted order, or null when nothing was promoted
 */
export async function promoteNextQueuedOrder(userId, url) {
  if (!url) return null;

  const hasActive = await db.order.findOne({
    where: { userId, url, status: OrderStatus.Progress, deletedAt: null },
    select: { id: true },
  });
  if (hasActive) return null;

  const queued = await db.order.findOne({
    where: {
      userId,
      url,
      status: OrderStatus.InQueue,
      deletedAt: null,
      // Limit-queued orders (Free_Order_Limit) are only promoted by the cron job,
      // which is what enforces FIFO fairness once capacity frees up.
      OR: [{ reason: null }, { reason: { not: OrderCancelCode.FreeOrderLimit } }],
    },
    sort: { id: 'asc' },
    include: { account: true },
  });
  if (!queued) return null;

  // Promoting a Free order must still respect the global cap.
  if (queued.type === OrderType.Free && !(await hasFreeOrderCapacity())) {
    await db.order.update({
      where: { id: queued.id },
      data: { reason: OrderCancelCode.FreeOrderLimit },
    });
    return null;
  }

  const startCount = await resolveStartCount(queued);

  return db.order.update({
    where: { id: queued.id },
    data: {
      status: OrderStatus.Progress,
      reason: null,
      startCount: BigInt(Math.trunc(startCount)),
      expectedCount: BigInt(Math.trunc(startCount + (queued.maxProgress ?? 0))),
    },
  });
}

/**
 * The live counter a promoted order should start from.
 *
 * A provider outage yields 0 rather than throwing: refusing to promote would
 * strand the order in InQueue forever, and the checker re-anchors from the live
 * count on the first verification anyway.
 */
async function resolveStartCount(order) {
  if (order.isLikes) {
    const post = await getPostInfo(order.url);
    return post?.likeCount ?? 0;
  }

  const profile = await getProfileInfo(
    order.account?.username ?? order.username,
    order.account?.secUid ?? null,
  );
  return profile?.followerCount ?? 0;
}
