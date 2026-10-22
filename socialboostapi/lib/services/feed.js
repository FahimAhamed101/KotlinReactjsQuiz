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
 * Serve the viewer's feed, and never let it stay empty because of skips alone.
 *
 * A skip is meant to mean "not this one, right now" — it is a *deferral*, not a
 * permanent ban. With the real app that distinction never mattered, because other
 * users are constantly creating orders and the feed refills itself. In a demo /
 * launch environment there are only a handful of circulating orders, so a viewer
 * who skips each of the 3-times reaches the tombstone on every single task and the
 * feed is then empty *forever* — which is exactly the "no task available" bug:
 * all 15 demo orders were sitting at skip count 3 for this account.
 *
 * So when the well is genuinely dry AND the reason is exhausted skips, we forgive
 * the skips and serve the tasks again. The `< 3` fallback and the normal loop are
 * both tried first, so this never overrides a feed that has anything to offer.
 *
 * @param {{userId:number, accountId:number|null, username:string|null, page:number, perPage:number}} ctx
 */
export async function getFeed(ctx) {
  const first = await collectFeed(ctx);
  if (first.items.length > 0 || !ctx.accountId) return first;

  const exhausted = await db.skipCount.find({
    where: { accountId: ctx.accountId, count: { gte: SKIP_REAPPEAR_THRESHOLD } },
    limit: 1,
  });
  if (exhausted.length === 0) return first; // nothing to forgive — the feed is truly empty

  await db.skipCount.deleteMany({
    where: { accountId: ctx.accountId, count: { gte: SKIP_REAPPEAR_THRESHOLD } },
  });
  return collectFeed(ctx);
}

async function collectFeed({ userId, accountId, username, page = 1, perPage = 10 }) {
  const items = [];

  for (const priority of [OrderPriority.Normal, OrderPriority.Low]) {
    // "Special" orders are only eligible on the first page.
    const types = page === 1 ? ['Special', 'Premium', 'Free'] : ['Premium', 'Free'];

    // Fetch generously and filter in JS: `isAlreadyCredited` / `isSkipped` are
    // per-viewer exclusions that cannot be expressed in one Mongo query, so a tight
    // `limit` here would silently truncate the page. The Progress set is small.
    const candidates = await db.order.find({
      where: {
        status: OrderStatus.Progress,
        type: { in: types },
        priority,
        deletedAt: null,
      },
      include: orderInclude,
      sort: { id: 'desc' },
      limit: 1000,
    });

    const eligible = [];
    for (const order of candidates) {
      // Never serve a viewer their own order. Completing it would be self-dealing: they
      // would earn the completion reward for an action they "performed" on themselves.
      // Laravel excludes by user_id AND by the linked account, so match both here.
      if (order.userId != null && Number(order.userId) === Number(userId)) continue;
      if (accountId != null && order.accountId != null && Number(order.accountId) === Number(accountId)) continue;

      if (await isAlreadyCredited(userId, accountId, order)) continue;
      if (await isSkipped(accountId, order.id)) continue;
      eligible.push(order);
    }

    // Laravel calls ->paginate($limit) here, i.e. a real offset. This port read the
    // `page` parameter, echoed it back in the envelope, and then never used it — every
    // request returned the first `perPage` eligible orders, so with 15 orders in
    // circulation the feed served the same 10 forever and the other 5 were unreachable,
    // and `has_next` was permanently true. Paginate the filtered list.
    const start = (page - 1) * perPage;
    const slice = eligible.slice(start, start + perPage);

    if (slice.length > 0) {
      items.push(...slice);
      return { items, hasNext: eligible.length > start + perPage, page, usedFallback: false };
    }
  }

  // --- Fallback: orders this account skipped, until skipped 3x ---
  if (accountId) {
    // Same offset as above: the fallback must page too, or re-requesting it returns
    // the same rows.
    const start = (page - 1) * perPage;
    const skips = await db.skipCount.find({
      where: { accountId, count: { lt: SKIP_REAPPEAR_THRESHOLD } },
      sort: { id: 'asc' },
      skip: start,
      limit: perPage,
    });

    if (skips.length > 0) {
      // Ask for one extra so `hasNext` is a real answer rather than a guess.
      const fallbackOrders = await db.order.find({
        where: {
          id: { in: skips.map((s) => s.orderId) },
          status: OrderStatus.Progress,
          deletedAt: null,
          userId: { not: userId },
        },
        include: orderInclude,
        sort: { id: 'asc' },
        limit: perPage + 1,
      });

      const slice = fallbackOrders.slice(0, perPage);
      return {
        items: slice,
        hasNext: fallbackOrders.length > perPage,
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
