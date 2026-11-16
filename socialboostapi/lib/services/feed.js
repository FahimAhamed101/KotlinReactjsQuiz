// Order feed selection.
//
// Ported from App\Services\OrderFeed\OrderFeedFactory.
//
// Serves *other people's* in-progress orders to the viewer, excluding:
//   * orders on a network other than the one the viewer is signed in on,
//   * the viewer's own orders (by user_id and by linked account username),
//   * orders the viewer's account has already been credited for
//     (a coins_histories row matching username / post_pk / account),
//   * orders the viewer's account has skipped.
//
// If the normal feed is empty, it falls back to orders the viewer skipped fewer
// than 3 times, so a task reappears until it has been skipped three times.

import db from '../db';
import { OrderPriority, OrderStatus } from '../constants';
import { normalizePlatform } from './platforms';
import { TASK_HISTORY_TYPES } from './postActions';

const SKIP_REAPPEAR_THRESHOLD = 3;

const orderInclude = {
  product: { include: { productType: true } },
  user: true,
  account: true,
};

/**
 * Restrict the feed to the viewer's own network.
 *
 * A follow/like is verified by comparing the *viewer's own* counter on the task's
 * network against the snapshot taken when the task was served — `verifyFollow` calls
 * `profileFor(account)`, and `account` is the row resolved from the request's
 * `platform`. So an Instagram task handed to a TikTok-only viewer can never verify:
 * following on Instagram does not move the TikTok following count, the comparison
 * reads "no new follow", and the task silently never pays no matter how many times it
 * is completed. Serving those rows is how a TikTok user ended up with
 * "Follow @nike on Instagram" cards that were impossible to earn from.
 *
 * Scoping the feed is what makes the promise "if the user follows, he gets a coin"
 * actually hold: the only tasks offered are ones the viewer is on the right network to
 * complete.
 *
 * Rows written before `platform` existed carry no value, and every order from that era
 * was a TikTok order — so a null is treated as TikTok: visible to a TikTok viewer, and
 * to nobody else.
 */
function platformClause(platform) {
  const p = normalizePlatform(platform);
  return p === 'tiktok' ? { platform: { in: ['tiktok', null] } } : { platform: p };
}

/**
 * Collapse orders that point at the same destination, keeping one row per `url`.
 *
 * Ported from OrderFeedFactory::uniqueElements, which hashes on `$element["url"]`:
 *
 *   foreach ($arr as $element) { $unique_array[$element["url"]] = $element; }
 *
 * In PHP, re-assigning an existing key overwrites the value but leaves the key at its
 * original position — so the survivor sits where the *first* duplicate sat and carries
 * the *last* duplicate's payload. A Map gives the identical result in JS, which matters
 * because the payload is what the client renders (id, owner, reward).
 *
 * Without this, three separate orders for the same Instagram post were served as three
 * visually identical cards — "Like @fahim_prime3000" repeated, and likewise for @nike
 * and @shermurod.lvl2010. The viewer cannot tell them apart, so the list looks broken
 * and the same task appears to be re-offered forever. Only the first can actually pay
 * (the later ones are caught by isAlreadyCredited once one succeeds), so the extra rows
 * were pure noise.
 */
function uniqueElements(orders) {
  const byUrl = new Map();
  for (const order of orders) {
    // An order with no url cannot be compared to anything, so it must not collapse into
    // some other url-less order. Key those on their own id.
    const key = order.url ? String(order.url) : `#id:${order.id}`;
    byUrl.set(key, order);
  }
  return [...byUrl.values()];
}

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
 * @param {{userId:number, accountId:number|null, username:string|null, platform?:string,
 *   page:number, perPage:number}} ctx
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

async function collectFeed({ userId, accountId, username, platform, page = 1, perPage = 10 }) {
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
        ...platformClause(platform),
      },
      include: orderInclude,
      sort: { id: 'desc' },
      limit: 1000,
    });

    const eligible = [];
    for (const order of candidates) {
      // Never serve a viewer their own order. Completing it would be self-dealing: they
      // would earn the completion reward for an action they "performed" on themselves.
      // Laravel excludes by user_id AND by the target handle (`->where('username', '!=',
      // $account->username)`); the linked-account comparison is kept as well, because it
      // still catches an order whose handle was edited after the order was placed.
      if (order.userId != null && Number(order.userId) === Number(userId)) continue;
      if (accountId != null && order.accountId != null && Number(order.accountId) === Number(accountId)) continue;
      if (username && String(order.username).toLowerCase() === String(username).toLowerCase()) continue;

      if (await isAlreadyCredited(username, order)) continue;
      if (await isSkipped(accountId, order.id)) continue;
      eligible.push(order);
    }

    // Laravel calls ->paginate($limit) here, i.e. a real offset. This port read the
    // `page` parameter, echoed it back in the envelope, and then never used it — every
    // request returned the first `perPage` eligible orders, so with 15 orders in
    // circulation the feed served the same 10 forever and the other 5 were unreachable,
    // and `has_next` was permanently true. Paginate the filtered list.
    //
    // De-duplicate before paginating, so a page is `perPage` distinct destinations and
    // `hasNext` means "more distinct tasks", not "more rows that look the same".
    const deduped = uniqueElements(eligible);
    const start = (page - 1) * perPage;
    const slice = deduped.slice(start, start + perPage);

    if (slice.length > 0) {
      items.push(...slice);
      return { items, hasNext: deduped.length > start + perPage, page, usedFallback: false };
    }
  }

  // --- Fallback: orders this account skipped, until skipped 3x ---
  if (accountId) {
    // Read the whole skip set and paginate the *filtered* result below, for the same
    // reason the main feed does: paging the skip rows first and filtering afterwards
    // returns a short page and a `hasNext` that does not mean anything.
    const skips = await db.skipCount.find({
      where: { accountId, count: { lt: SKIP_REAPPEAR_THRESHOLD } },
      sort: { id: 'asc' },
      limit: 1000,
    });

    if (skips.length > 0) {
      // The platform clause applies here as well — a skipped task from another network
      // must not sneak back in through the fallback.
      const fallbackOrders = await db.order.find({
        where: {
          id: { in: skips.map((s) => s.orderId) },
          status: OrderStatus.Progress,
          deletedAt: null,
          userId: { not: userId },
          ...platformClause(platform),
        },
        include: orderInclude,
        sort: { id: 'asc' },
        limit: 1000,
      });

      // Laravel's getSkippedOrders runs the *same* two history exclusions as the main
      // feed (the `whereNotExists` on coins_histories, keyed on the target handle and on
      // post_pk). Omitting them made the fallback the one path that still handed back a
      // task already paid for — the "Could not verify" loop, reached through Skip.
      const eligible = [];
      for (const order of fallbackOrders) {
        if (username && String(order.username).toLowerCase() === String(username).toLowerCase()) continue;
        if (await isAlreadyCredited(username, order)) continue;
        eligible.push(order);
      }

      // Laravel's getAllSkippedOrders runs the same `uniqueElements` on the merged skip
      // set, so the fallback collapses duplicates exactly like the main feed does.
      const deduped = uniqueElements(eligible);
      const start = (page - 1) * perPage;
      const slice = deduped.slice(start, start + perPage);
      if (slice.length > 0) {
        return {
          items: slice,
          hasNext: deduped.length > start + perPage,
          page,
          usedFallback: true,
        };
      }
    }
  }

  return { items: [], hasNext: false, page, usedFallback: false };
}

/**
 * Has the viewer already been paid for acting on this order's target?
 *
 * Ported from the two `whereNotExists` blocks in
 * OrderFeedFactory::getOrdersForUser, which key on the *thing acted upon* rather than on
 * the order row:
 *
 *   follow   -> a coins_histories row for this viewer whose own order targets the same
 *               handle (`whereColumn('o2.username', 'orders.username')`), so a second
 *               order for the same person is not offered once you already follow them,
 *   like/…   -> a coins_histories row for this viewer carrying the same `post_pk`.
 *
 * This used to match `orderId: order.id` together with `accountId: order.accountId`.
 * That pair can never match: `orders.account_id` is the *order owner's* account, while
 * the ledger records the *viewer's* (`credit()` writes `accountId: account.id` for the
 * viewer, and Laravel's addToHistoryAndIncreaseCoins does the same). The exclusion was
 * therefore dead, so a task that had already paid out came straight back into the feed —
 * and tapping it again could not pay, which surfaced to the user as "Could not verify"
 * for a task they had genuinely completed moments earlier.
 */
async function isAlreadyCredited(viewerUsername, order) {
  if (!viewerUsername) return false;

  // A post action is identified by the post it was performed on.
  if (order.postPk) {
    const hit = await db.coinsHistory.findOne({
      where: {
        username: viewerUsername,
        postPk: order.postPk,
        orderId: { not: null },
        type: { in: TASK_HISTORY_TYPES },
      },
      select: { id: true },
    });
    return !!hit;
  }

  // A follow is identified by *who* was followed, across every order for that handle:
  // already following @x means no order targeting @x can pay again.
  if (!order.username) return false;

  const siblings = await db.order.find({
    where: { username: order.username },
    select: { id: true },
    limit: 1000,
  });
  if (!siblings.length) return false;

  const hit = await db.coinsHistory.findOne({
    where: {
      username: viewerUsername,
      postPk: null,
      orderId: { in: siblings.map((o) => o.id) },
      type: { in: TASK_HISTORY_TYPES },
    },
    select: { id: true },
  });
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
