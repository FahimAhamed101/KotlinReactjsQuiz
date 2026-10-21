// Order creation.
//
// Ported from App\Services\OrderService::createNewOrderV4 (the v4/v5/v6 path) and
// its helpers resolveOrderStartState / getOrderCountWithBonus / checkOrdersCount.

import db from '../db';
import { OrderStatus, OrderType, OrderPriority, ProductCategory, CoinHistoryType, REASON_BILLING_NOT_PROCEEDED, CANCELLED_STATUSES } from '../constants';
import { getFloat, getInt } from '../settings';
import { err, ApiException } from '../errors';
import { reactivationIneligibilityReason } from '../resources';
import { getPostInfo, getProfileInfo } from './tiktok';
import { resolveVideoUrl, canonicalVideoUrl } from './videoUrl';
import { validateOfferProduct } from './offers';
import { upsertAccountFromProfile } from './coinsCheck';

/**
 * POST /orders (v4/v5/v6).
 * @see V4OrderController::create
 */
export async function createOrderV4({ user, body }) {
  const product = await db.product.findOne({
    where: { id: Number(body.product_id) },
    include: { productType: true },
  });
  if (!product) throw err.productNotFound('Product not found.');

  const isLikes = isLikesProduct(product);
  const isOfferProduct = product.category === ProductCategory.Offer;
  const isFree = product.coinsPrice !== null && product.coinsPrice !== undefined;
  const type = isFree ? OrderType.Free : OrderType.Premium;

  // --- Checks that produce a refusal, ordered so the message matches the real blocker ---
  //
  // The order of these checks IS the error the user sees. Resolving the target link first
  // would tell someone who cannot afford a package "that link is not a video" - wrong, and
  // unactionable, because the fix is a different message and a different action. Running
  // the cheap checks first also means a refused order makes no provider calls at all.
  if (isFree) {
    if (user.coins < product.coinsPrice) {
      throw err.coinsNotEnough('Not enough coins.');
    }
    await checkOrdersCount(user.id);
  }

  let offer = null;
  if (isOfferProduct) {
    // Offer eligibility is also a refusal the user cannot act on from the order form.
    offer = await validateOfferProduct(user, product, body.offer_id);
  }

  // A likes order is anchored to one video, so the URL has to be resolved *before* the
  // account: the handle in the link is the authoritative target, and the client's
  // `username` may be stale or may be the viewer rather than the video's owner.
  //
  // This also replaces trusting `body.post_pk`: the id comes out of the URL the user
  // pasted. Previously the client sent a profile URL plus a made-up `post_pk`
  // ("video_1", or `url.hashCode()`), `getPostInfo` could not read a like count from a
  // profile, and every likes order died with "Could not read that video".
  let video = null;
  if (isLikes) {
    video = await resolveVideoUrl(body.url);
    if (!video) {
      throw err.invalidUsernameOrUrl(
        'Paste the link to a single TikTok video (…/@username/video/1234567890). ' +
          'A profile link cannot be boosted for likes.',
      );
    }
  }

  // Resolve the target account. Prefer the handle from the video link when we have one.
  const account = await resolveTargetAccount(body, { preferUsername: video?.username ?? null });
  if (!account) throw err.invalidUsernameOrUrl('Could not resolve the TikTok account.');

  // --- Fetch the target's live counters to anchor start_count ---
  let startCount = 0;
  let canonicalUrl = body.url;
  let postPk = body.post_pk ?? null;
  let image = account.avatarLarger ?? '';

  if (isLikes) {
    canonicalUrl = canonicalVideoUrl(video);
    postPk = video.postId;

    const post = await getPostInfo(canonicalUrl);
    if (!post) {
      throw err.invalidUsernameOrUrl(
        'Could not read that video. Check the link opens a single public TikTok video.',
      );
    }
    startCount = post.likeCount;
    if (post.cover) image = post.cover;
  } else {
    const profile = await getProfileInfo(account.username, account.secUid);
    if (!profile) throw err.invalidUsernameOrUrl('Could not read that profile.');
    startCount = profile.followerCount;
    canonicalUrl = `https://www.tiktok.com/@${profile.username}`;
    if (profile.avatarLarger) image = profile.avatarLarger;
  }

  const bonus = await orderCountWithBonus(product.actionCount, isLikes, isFree);
  const expectedCount = startCount + bonus;
  const actualMaxProgress = bonus;

  if (isFree) {
    // Affordability and the per-user order limit were already checked before any network
    // call — see above. This block is now only the deduction.
    return db.transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          userId: user.id,
          productId: product.id,
          offerId: offer?.id ?? null,
          accountId: account.id,
          image,
          username: account.username,
          url: canonicalUrl,
          postPk,
          startCount: BigInt(startCount),
          expectedCount: BigInt(expectedCount),
          status: OrderStatus.Progress,
          type,
          currentProgress: 0,
          maxProgress: bonus,
          actualMaxProgress,
          isLikes,
          clicks: 0,
          priority: OrderPriority.Normal,
        },
        include: { product: { include: { productType: true } }, user: true },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { coins: { decrement: product.coinsPrice }, lastActivityAt: new Date() },
      });

      await tx.coinsHistory.create({
        data: {
          userId: user.id,
          orderId: order.id,
          accountId: account.id,
          username: account.username,
          postPk,
          type: isLikes ? CoinHistoryType.LikesOrder : CoinHistoryType.FollowersOrder,
          lost: product.coinsPrice,
          count: product.actionCount,
        },
      });

      return order;
    });
  }

  // --- Premium (Google Play) order: created Pending, paid via /payment/notify ---
  // Clean up any stale or previous pending orders so user never gets blocked by pending limits
  await db.order.deleteMany({
    where: { userId: user.id, status: OrderStatus.Pending },
  }).catch(() => {});

  const order = await db.order.create({
    data: {
      userId: user.id,
      productId: product.id,
      offerId: offer?.id ?? null,
      accountId: account.id,
      image,
      username: account.username,
      url: canonicalUrl,
      postPk,
      startCount: BigInt(startCount),
      expectedCount: BigInt(expectedCount),
      status: OrderStatus.Pending,
      type,
      currentProgress: 0,
      maxProgress: bonus,
      actualMaxProgress,
      isLikes,
      clicks: 0,
      priority: OrderPriority.Normal,
      purchaseToken: null,
    },
    include: { product: { include: { productType: true } }, user: true },
  });

  await db.user.update({
    where: { id: user.id },
    data: { lastActivityAt: new Date(), lastPurchaseAt: new Date() },
  });

  return order;
}

/** Products whose product_type is "Likes". */
function isLikesProduct(product) {
  const name = (product.productType?.name ?? '').toLowerCase();
  return name.includes('like');
}

/**
 * Apply the order-count bonus multiplier.
 * Free orders use the Free* settings, Premium orders the premium* ones.
 */
export async function orderCountWithBonus(actionCount, isLikes, isFree) {
  const key = isFree
    ? isLikes
      ? 'FreeLikesOrderBonus'
      : 'FreeFollowOrderBonus'
    : isLikes
      ? 'premiumLikesOrderBonus'
      : 'premiumFollowOrderBonus';

  const multiplier = await getFloat(key, 0);
  return Math.round(actionCount * (1 + multiplier));
}

/** A user may only hold so many in-flight orders. */
export async function checkOrdersCount(userId) {
  const max = await getInt('maxOrdersPerUser', 100);
  const active = await db.order.count({
    where: {
      userId,
      status: { in: [OrderStatus.Progress, OrderStatus.InQueue] },
      deletedAt: null,
    },
  });
  if (active >= max) {
    throw err.ordersLimitExceeded('You have reached the maximum number of active orders.');
  }
  return active;
}

/** Resolve the target account for an order from sec_uid or username. */
async function resolveTargetAccount(body, { preferUsername = null } = {}) {
  const secUid = body.sec_uid || null;
  const username = body.username ? String(body.username).toLowerCase() : null;

  // A likes order names its target in the video link. That handle must win over the
  // viewer's `sec_uid` — otherwise boosting someone else's video would resolve to the
  // viewer's own account and anchor the order to the wrong profile.
  if (preferUsername) {
    const handle = String(preferUsername).toLowerCase();
    const known = await db.account.findOne({ where: { username: handle } });
    if (known) return known;

    const profile = await getProfileInfo(handle, null);
    if (!profile) return null;
    return upsertAccountFromProfile(profile);
  }

  if (secUid) {
    const found = await db.account.findOne({ where: { secUid } });
    if (found) return found;
  }
  if (username) {
    const found = await db.account.findOne({ where: { username } });
    if (found) return found;
  }

  const profile = await getProfileInfo(username, secUid);
  if (!profile) return null;
  return upsertAccountFromProfile(profile);
}

/**
 * Where a new order should start.
 * Mirrors OrderService::resolveOrderStartState — a duplicate url for the same
 * user queues rather than running in parallel.
 */
export async function resolveOrderStartState(userId, url) {
  const duplicate = await db.order.findOne({
    where: { userId, url, status: OrderStatus.Progress, deletedAt: null },
    select: { id: true },
  });
  if (duplicate) return { status: OrderStatus.InQueue, reason: null };

  return { status: OrderStatus.Progress, reason: null };
}

/**
 * GET /orders/{id}.
 * Mirrors OrderService::getOrderDetail — another user's order is returned with its
 * counters stripped rather than refused, so a shared link still renders.
 */
export async function getOrderDetail(user, id) {
  const order = await db.order.findOne({
    where: { id },
    include: { product: true, user: true },
  });

  if (!order) throw err.missingArgument('Order not found.');

  return { order, isOwnOrder: order.userId === user.id };
}

/**
 * DELETE /orders.
 * Mirrors OrderService::deletePendingOrder — only a *pending, unpaid* order may be
 * deleted. Anything already running must go through support, because coins or money
 * have been committed against it.
 */
export async function deletePendingOrder(user, orderId) {
  const order = await db.order.findOne({
    where: { id: orderId, userId: user.id, deletedAt: null },
  });

  if (!order) throw err.orderNotFound('Order not found.');

  if (order.status !== OrderStatus.Pending) {
    throw err.orderNotDeletable('Only pending unpaid orders can be deleted.');
  }

  // Laravel does update({reason}) then soft delete(). Prisma has no soft delete, so
  // deletedAt is set explicitly; the row is kept for the audit trail.
  await db.order.update({
    where: { id: order.id },
    data: { reason: REASON_BILLING_NOT_PROCEEDED, deletedAt: new Date() },
  });
}

/**
 * POST /orders/reactivate.
 * Mirrors OrderService::reactivateOrder -> reactivateCancelledOrder.
 *
 * A cancelled order may be revived once, but only while its target is still
 * reachable — reactivating an order for a deleted video would spend the user's
 * remaining coins on a task that can never complete.
 */
export async function reactivateOrder(user, orderId) {
  const order = await db.order.findOne({
    where: {
      id: orderId,
      userId: user.id,
      // Both spellings: Laravel wrote 'Cancelled', an earlier build of this port
      // wrote 'Canceled'. Matching only one makes every order cancelled by the
      // other build permanently un-reactivatable — it reports "Order not found."
      status: { in: CANCELLED_STATUSES },
      deletedAt: null,
    },
    include: { account: true },
  });

  // An order that is not cancelled at all is a missing argument, exactly as the
  // Laravel query-then-throw does; an order that *is* cancelled but ineligible gets
  // the specific reason.
  if (!order) throw err.missingArgument('Order not found.');

  const ineligibility = reactivationIneligibilityReason(order);
  if (ineligibility) throw new ApiException('Unknown', ineligibility, 422);

  const availability = await getReactivationAvailability(order);
  if (!availability.available) {
    throw new ApiException(
      'Unknown',
      'The associated video or profile is no longer available.',
      422,
    );
  }

  // Hoisted out of the transaction on purpose: resolveOrderStartState reads through
  // the global client, and on SQLite a second connection reading inside an open
  // interactive transaction risks "database is locked".
  const startState = await resolveOrderStartState(
    order.userId,
    availability.url ?? order.url,
  );

  return db.transaction(async (tx) => {
    const locked = await tx.order.findOne({ where: { id: order.id } });

    if (!locked) throw err.missingArgument('Order not found.');

    // Re-check against the locked row: a concurrent request may have reactivated
    // this order between the read above and the lock.
    const stillIneligible = reactivationIneligibilityReason(locked);
    if (stillIneligible) throw new ApiException('Unknown', stillIneligible, 422);

    return tx.order.update({
      where: { id: locked.id },
      // Included so the resource can render product/user; without it the response
      // would carry nulls for both.
      include: { product: true, user: true },
      data: {
        username: availability.username ?? locked.username,
        url: availability.url ?? locked.url,
        startCount: BigInt(Math.trunc(availability.startCount)),
        expectedCount: BigInt(Math.trunc(availability.startCount + locked.maxProgress)),
        // Carry the progress already made across, so the task resumes rather than
        // restarting from zero.
        clicks: locked.currentProgress,
        priority: OrderPriority.Normal,
        status: startState.status,
        reason: startState.reason,
        reactivatedAt: new Date(),
        reactivationCount: locked.reactivationCount + 1,
      },
    });
  });
}

/**
 * Is the reactivation target still reachable, and what are its current counters?
 * Mirrors OrderService::getReactivationAvailability.
 *
 * Caveat: this port's tiktok service returns null when every provider is down, so a
 * provider outage is indistinguishable from a deleted target — both refuse
 * reactivation. The Laravel original distinguished them with a per-provider
 * `available` flag.
 */
async function getReactivationAvailability(order) {
  if (order.isLikes) {
    const post = await getPostInfo(order.url);

    return {
      available: post !== null,
      startCount: post?.likeCount ?? Number(order.startCount ?? 0),
    };
  }

  const profile = await getProfileInfo(order.username, order.account?.secUid ?? null);

  const available = !!profile && !profile.secret && !profile.privateAccount;
  const username = profile?.username ?? order.username;

  return {
    available,
    startCount: profile?.followerCount ?? Number(order.startCount ?? 0),
    username,
    url: `https://www.tiktok.com/@${username}`,
  };
}

export { REASON_BILLING_NOT_PROCEEDED };
