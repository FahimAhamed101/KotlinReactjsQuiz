// Order feed selection.
//
// Ported from App\Services\OrderFeed\OrderFeedFactory.
//
// Serves *other people's* in-progress orders to the viewer, excluding:
//   * the viewer's own orders (by user_id and by linked account username),
//   * orders the viewer's account has already been credited for
//     (a coins_histories row matching username / post_pk / account),
//   * orders the viewer's account has skipped.
//
// If the normal feed is empty, it falls back to orders the viewer skipped fewer
// than 3 times, so a task reappears until it has been skipped three times.

import db from '../db';
import { OrderPriority, OrderStatus } from '../constants';

const SKIP_REAPPEAR_THRESHOLD = 3;

const orderInclude = {
  product: { include: { productType: true } },
  user: true,
  account: true,
};

/**
 * @param {{userId:number, accountId:number|null, username:string|null, page:number, perPage:number}} ctx
 */
export async function getFeed({ userId, accountId, username, page = 1, perPage = 10 }) {
  const items = [];

  for (const priority of [OrderPriority.Normal, OrderPriority.Low]) {
    // "Special" orders are only eligible on the first page.
    const types = page === 1 ? ['Special', 'Premium', 'Free'] : ['Premium', 'Free'];

    const candidates = await db.order.find({
      where: {
        status: OrderStatus.Progress,
        type: { in: types },
        priority,
        deletedAt: null,
      },
      include: orderInclude,
      sort: { id: 'desc' },
      limit: perPage * 3,
    });

    const eligible = [];
    for (const order of candidates) {
      if (await isAlreadyCredited(userId, accountId, order)) continue;
      if (await isSkipped(accountId, order.id)) continue;
      eligible.push(order);
      if (eligible.length >= perPage) break;
    }

    if (eligible.length > 0) {
      items.push(...eligible);
      return { items, hasNext: eligible.length >= perPage, page, usedFallback: false };
    }
  }

  // --- Fallback: orders this account skipped, until skipped 3x ---
  if (accountId) {
    const skips = await db.skipCount.find({
      where: { accountId, count: { lt: SKIP_REAPPEAR_THRESHOLD } },
      sort: { id: 'asc' },
      limit: perPage,
    });

    if (skips.length > 0) {
      const fallbackOrders = await db.order.find({
        where: {
          id: { in: skips.map((s) => s.orderId) },
          status: OrderStatus.Progress,
          deletedAt: null,
          userId: { not: userId },
        },
        include: orderInclude,
        sort: { id: 'asc' },
        limit: perPage,
      });

      return {
        items: fallbackOrders,
        hasNext: fallbackOrders.length >= perPage,
        page,
        usedFallback: true,
      };
    }
  }

  return { items: [], hasNext: false, page, usedFallback: false };
}

/**
 * Has the viewer's account already been credited for this order?
 * Matches on account_id when both sides have one, otherwise on username.
 * Mirrors CoinsCheckService::matchAccount + the history dedup query.
 */
async function isAlreadyCredited(userId, accountId, order) {
  const where = {
    userId,
    orderId: order.id,
    type: { in: ['FollowTask', 'LikeTask'] },
  };

  if (accountId && order.accountId) {
    where.accountId = order.accountId;
  } else if (order.username) {
    where.username = order.username;
  } else {
    return false;
  }

  const hit = await db.coinsHistory.findOne({ where, select: { id: true } });
  return !!hit;
}

async function isSkipped(accountId, orderId) {
  if (!accountId) return false;
  const hit = await db.skipCount.findOne({
    where: { accountId, orderId },
    select: { id: true },
  });
  return !!hit;
}

/**
 * Hide sensitive fields on orders that do not belong to the caller.
 * Ported from OrderService::hideSensitiveData — the client must not learn the
 * internal progress/order identifiers of other users' orders.
 */
export function hideSensitiveData(order) {
  if (!order) return order;
  return {
    ...order,
    startCount: null,
    expectedCount: null,
    orderId: null,
    purchaseToken: null,
  };
}
