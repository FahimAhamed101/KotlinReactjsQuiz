// Coin verification — the heart of the like/follow economy.
//
// Ported from App\Services\CoinsCheckService::handleCheck (the V2 protocol used by
// v2/v3/v5/v6) plus handleLikeCount / handleFollowCount /
// addToHistoryAndIncreaseCoins / syncCycleFollowingCount / refreshAccountProfile.
//
// Flow:
//   1. Idempotency — if this (user, order, account) has already been credited,
//      return { is_success:false, already:true } and never double-pay.
//   2. Retry up to `maxTaskTry` times, sleeping between attempts.
//   3. Verify the action really happened by comparing the target's live counters
//      against the snapshot taken when the task was served (the `follow_counts`
//      anchor / the `like_counts` row).
//   4. Credit coins inside a transaction, bump progress, complete the order if
//      it is now full.
//
// Known gap versus Laravel: `addToSmmPanelIfEligible` is not ported, because this
// port has no SMM-panel integration at all (no `smm_orders` collection, no
// SmmPanelService). An order that reaches the handover threshold therefore stays
// in Progress instead of being handed to a panel. Nothing else depends on it.

import db from '../db';
import { getInt } from '../settings';
import { CoinHistoryType, OrderStatus, OrderCancelCode } from '../constants';
import { getPostInfo, getProfileInfo } from './tiktok';
import { err } from '../errors';
import { completeOrder, promoteNextQueuedOrder } from './orderLifecycle';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} p
 * @param {number} p.userId
 * @param {object} p.body   the validated /coins/check payload
 * @returns {Promise<{is_success:boolean, coins_earned:number, already:boolean,
 *   need_relogin:boolean, is_unavailable:boolean}>}
 */
export async function handleCheck({ userId, body }) {
  const orderId = Number(body.order_id);

  const account = await resolveAccount(body);
  if (!account) throw err.userNotFound('TikTok account not found.');

  const order = await db.order.findOne({ where: { id: orderId } });
  if (!order) throw err.unknown('Order not found.');

  // Every check counts as a click on the order, even a failed one.
  await db.order.update({ where: { id: order.id }, data: { clicks: { increment: 1 } } });

  // --- 1. Idempotency ---------------------------------------------------
  if (await alreadyCredited(userId, order, account)) {
    return failure({ already: true });
  }

  await sleep((await getInt('waitPerTask', 0)) * 1000);

  const maxTry = Math.max(1, await getInt('maxTaskTry', 2));

  // --- 2/3. Verify, with retries ---------------------------------------
  for (let attempt = 0; attempt < maxTry; attempt++) {
    // Laravel re-checks idempotency at the top of every retry (not just once
    // before the loop) and sleeps `$i * 2` seconds at the *end* of an attempt.
    // The net effect is that the first retry is immediate and only the third and
    // later ones wait — reproduced exactly here.
    if (attempt > 0) {
      if (await alreadyCredited(userId, order, account)) {
        return failure({ already: true });
      }
      await sleep((attempt - 1) * 2 * 1000);
    }

    const result = order.isLikes
      ? await verifyLike({ order, account, body })
      : await verifyFollow({ order, account, body });

    if (result.credited) {
      const coins = await credit({
        userId,
        order,
        account,
        type: order.isLikes ? CoinHistoryType.LikeTask : CoinHistoryType.FollowTask,
      });

      // Laravel runs these after crediting, outside the coin transaction. They
      // only touch the Account row; a failure must not undo the payout, so they
      // are best-effort.
      if (!order.isLikes) {
        await syncCycleFollowingCount(account, result.profile).catch(() => {});
        await refreshAccountProfile(account, result.profile).catch(() => {});
      }

      return {
        is_success: true,
        coins_earned: coins,
        already: false,
        need_relogin: false,
        is_unavailable: false,
      };
    }

    if (result.unavailable) {
      await cancelOrder(order.id, result.message, result.code);
      return { ...failure({ already: true }), is_unavailable: true };
    }

    if (result.hardStop) break;
  }

  return failure({ already: false });
}

// ---------------------------------------------------------------------------
// Like verification
// ---------------------------------------------------------------------------

async function verifyLike({ order, account, body }) {
  // Same reasoning as verifyFollow: `body.likes_incremented` used to short-circuit
  // this whole function and pay out on the client's word alone, so a like task cost
  // nothing to "complete". It is ignored now; the stored snapshot below is the
  // evidence. The client must prime that snapshot via POST /v6/posts/url before the
  // user taps Like.
  if (!order.postPk || order.status !== OrderStatus.Progress) {
    throw err.unknown('Order is not in progress.');
  }

  // Laravel fetches the post once, up front, and the checks below all read from
  // that same response. Fetching per-branch used to let a credit land on a video
  // that had already been deleted.
  const post = await getPostInfo(order.url);

  // --- v2 protocol: compare the live like count to the stored snapshot ---
  if (!post) {
    return {
      credited: false,
      unavailable: true,
      code: OrderCancelCode.UnavailableVideo,
      message: 'Video is unavailable',
    };
  }

  const row = await db.likesCount.findOne({
    where: { orderId: order.id, ...accountMatch('LikesCount', account) },
    sort: { id: 'desc' },
  });

  // Laravel treats a missing snapshot as a hard error rather than "not liked".
  // Returning a soft failure here would let the client retry forever against an
  // order the feed never actually served it.
  if (!row) throw err.unknown('Previous like count not found.');

  const latest = post.likeCount ?? 0;
  const previous = row.lastCount ?? 0;

  if (latest <= previous) {
    // No new like detected.
    return { credited: false };
  }

  await db.likesCount.update({
    where: { id: row.id },
    data: { lastCount: latest, isLiked: true },
  });

  return { credited: true };
}

// ---------------------------------------------------------------------------
// Follow verification
// ---------------------------------------------------------------------------

async function verifyFollow({ order, account, body }) {
  // The viewer's own following counter is the ONLY source of truth.
  //
  // An earlier build (a faithful port of the Laravel "confirmed follow protocol")
  // short-circuited here whenever the client sent `follow_incremented`, returning
  // `credited: true` without asking TikTok anything. Because the Android client
  // hard-codes that flag to `true`, every single tap on Follow paid out instantly:
  // the user could farm unlimited coins without following anyone, and the boost
  // order they were supposed to fill never advanced. `body.follow_incremented` is
  // now ignored outright — the counters below are the evidence.
  if (!order.username || order.status !== OrderStatus.Progress) {
    throw err.unknown('Order is not in progress.');
  }

  // Check the viewer's anchor count in follow_counts.
  const anchor = await db.followCount.findOne({
    where: accountMatch('FollowCount', account),
  });
  const previous = anchor?.followingCount ?? 0;

  // Live count for the viewer account.
  const profile = await getProfileInfo(account.username, account.secUid);

  // A provider outage is NOT the same as "the user did not follow".
  //
  // getProfileInfo() returns null when every provider is down (or cooling down
  // after a 502). Folding that into `?? 0` used to make the comparison below read
  // as "the count did not go up", so a single flaky provider silently denied a
  // payout the user had genuinely earned. Bail out instead and let the client retry.
  if (!profile || profile.followingCount === undefined || profile.followingCount === null) {
    return { credited: false };
  }

  const current = profile.followingCount;

  if (previous >= current) {
    // The order owner may have deleted or privatised their account. Laravel only
    // cancels when a provider *successfully reported* the profile as unavailable
    // or secret — a total outage must not cancel anything, because it says nothing
    // about the account. This port's provider returns null for both cases, so the
    // safe equivalent is: cancel only on a positive "this account is private".
    const ownerProfile = await getProfileInfo(order.username);
    if (ownerProfile && ownerProfile.secret) {
      return {
        credited: false,
        unavailable: true,
        code: OrderCancelCode.UnavailableAccount,
        message: 'TikTok account is unavailable',
      };
    }

    // The count went DOWN, i.e. the user unfollowed someone. Re-anchor the
    // baseline, otherwise it stays permanently out of reach and every later
    // follow is silently rejected.
    if (anchor && current < previous) {
      await db.followCount.update({
        where: { id: anchor.id },
        data: { followingCount: current },
      });
    }
    return { credited: false };
  }

  // A follow happened — but only credit it against a known baseline.
  if (!anchor) {
    // No baseline row yet, so the feed was never served for this account and we
    // have no "before" value to compare against. Anchor to the current count and
    // do NOT credit: `previous` silently defaulting to 0 made every account whose
    // following count merely happened to be non-zero look like it had just gained
    // a follow, handing out free coins to anyone who called this endpoint.
    await db.followCount.upsert({
      where: { username: account.username },
      create: {
        username: account.username,
        accountId: account.id,
        followingCount: current,
        lastCheckedFollowing: current,
      },
      update: { accountId: account.id, followingCount: current },
    });

    return { credited: false };
  }

  await db.followCount.update({
    where: { id: anchor.id },
    data: { followingCount: current },
  });

  return { credited: true, profile };
}

// ---------------------------------------------------------------------------
// Crediting
// ---------------------------------------------------------------------------

/**
 * Add a coins_histories row, bump the order's progress and the user's balance.
 * Mirrors CoinsCheckService::addToHistoryAndIncreaseCoins — the row lock is
 * reproduced with an interactive transaction plus a re-read inside it.
 *
 * The completion path differs from Laravel in one respect: Laravel calls
 * `promoteNextQueuedOrder` from inside the transaction, which makes live TikTok
 * calls while holding a write lock. Here the promotion is deferred until after
 * the commit — same observable outcome, without the lock held across the network.
 */
async function credit({ userId, order, account, type }) {
  const coinsPerTask = await getInt(type === CoinHistoryType.LikeTask ? 'like' : 'follow', 0);

  let justCompleted = false;

  await db.transaction(async (tx) => {
    const fresh = await tx.order.findOne({ where: { id: order.id } });
    if (!fresh) throw err.unknown('Order not found.');

    await tx.coinsHistory.create({
      data: {
        userId,
        orderId: order.id,
        accountId: account.id,
        // Laravel records the *viewer's* TikTok username here, not the order
        // owner's — the row is the viewer's receipt, and the idempotency lookup
        // in `alreadyCredited` matches on it.
        username: account.username,
        postPk: order.postPk,
        type,
        gain: coinsPerTask,
      },
    });

    // FollowTask rows advance the anchor the unfollow-deduction cycle compares
    // against, so the clawback measures unfollows from *after* this payout.
    if (type === CoinHistoryType.FollowTask) {
      const follow = await tx.followCount.findOne({
        where: accountMatch('FollowCount', account),
      });
      if (follow) {
        await tx.followCount.update({
          where: { id: follow.id },
          data: { lastCheckedFollowing: follow.followingCount },
        });
      }
    }

    const nextProgress = fresh.currentProgress + 1;
    await tx.order.update({
      where: { id: order.id },
      data: { currentProgress: nextProgress },
    });

    if (nextProgress >= fresh.actualMaxProgress) {
      await completeOrder(tx, order.id);
      justCompleted = true;
    }

    await tx.user.update({
      where: { id: userId },
      data: { coins: { increment: coinsPerTask }, lastActivityAt: new Date() },
    });
  });

  if (justCompleted) {
    await promoteNextQueuedOrder(order.userId, order.url).catch(() => {});
  }

  return coinsPerTask;
}

// ---------------------------------------------------------------------------
// Account cycle + profile refresh
// ---------------------------------------------------------------------------

/**
 * Re-baseline the account's unfollow-deduction cycle.
 * Mirrors CoinsCheckService::syncCycleFollowingCount — called with the profile we
 * already fetched, so it costs no extra TikTok call on the hot path.
 */
export async function syncCycleFollowingCount(account, profileInfo = null) {
  // Mirrors UnfollowCoinsDeductionsCycleService::getLastCycle — the most recently
  // *closed* cycle (ended_at set), not the newest row.
  const latestCycle = await db.unfollowCoinsDeductionCycle.findOne({
    where: { endedAt: { not: null } },
    sort: { id: 'desc' },
  });

  if (!latestCycle || account.coinDeductionCycleId === latestCycle.id) return;

  const profile =
    profileInfo ?? (await getProfileInfo(account.username, account.secUid));
  if (!profile || profile.followingCount === undefined || profile.followingCount === null) {
    return;
  }

  // The count includes the follow we just credited, so subtract it before using
  // it as the cycle's starting point.
  const newFollowingCount = Math.max(Math.trunc(profile.followingCount) - 1, 0);

  const data = { coinDeductionCycleId: latestCycle.id };
  if (newFollowingCount > (account.coinDeductionCycleStartFollowingCount ?? 0)) {
    data.coinDeductionCycleStartFollowingCount = newFollowingCount;
  }

  await db.account.update({ where: { id: account.id }, data });
}

/**
 * Refresh the Account row with the profile we already fetched.
 * Mirrors CoinsCheckService::refreshAccountProfile — bumping `updated_at` is the
 * point: the next login skips a live TikTok call when the row is fresh.
 */
export async function refreshAccountProfile(account, profileInfo) {
  if (!profileInfo) return;

  const pick = (next, current) => (next === undefined ? current : next);

  await db.account.update({
    where: { id: account.id },
    data: {
      nickname: pick(profileInfo.nickname, account.nickname),
      avatarLarger: pick(profileInfo.avatarLarger, account.avatarLarger),
      avatarMedium: pick(profileInfo.avatarMedium, account.avatarMedium),
      avatarThumb: pick(profileInfo.avatarThumb, account.avatarThumb),
      privateAccount: pick(profileInfo.secret, account.privateAccount),
      secret: pick(profileInfo.secret, account.secret),
      signature: pick(profileInfo.signature, account.signature),
      verified: pick(profileInfo.verified, account.verified),
      region: pick(profileInfo.region, account.region),
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reproduce the model `matchAccount` scopes.
 *
 * Rows written before `account_id` existed carry only a username, so each scope is
 * `account_id = X` OR `(account_id IS NULL AND username = X)`. `CoinsHistory` and
 * `FollowCount` match on `username`; `LikesCount` matches on `tt_username`.
 *
 * Matching on `account_id` alone (as an earlier build of this port did) silently
 * stops seeing every legacy row, which is exactly how a task gets paid twice.
 */
function accountMatch(modelName, account) {
  const usernameField = modelName === 'LikesCount' ? 'ttUsername' : 'username';

  return {
    OR: [
      { accountId: account.id },
      { accountId: null, [usernameField]: account.username },
    ],
  };
}

/** Resolve (or lazily create) the caller's linked TikTok account row. */
export async function resolveAccount(body) {
  const username = body.tt_username || body.username || body.profile_username || null;
  const secUid = body.sec_uid || null;

  if (secUid) {
    const bySec = await db.account.findOne({ where: { secUid } });
    if (bySec) return bySec;
  }
  if (username) {
    const lower = String(username).toLowerCase();

    // Mirrors AuthService::getAccountInfo — the username branch only considers
    // rows that already carry a sec_uid; a bare username with no sec_uid is
    // treated as unresolved and re-fetched from the provider.
    const byName = await db.account.findOne({
      where: { username: lower, secUid: { not: null } },
    });
    if (byName) return byName;

    const profile = await getProfileInfo(lower, secUid);
    if (!profile) return null;
    return upsertAccountFromProfile(profile);
  }
  return null;
}

/**
 * Insert/update an Account from a provider profile.
 *
 * The important rule here is that a **placeholder must never overwrite real data**.
 * `getProfileInfo` returns a deterministic stub when no RAPID_API_KEY is configured
 * (which is the case on the deployed Vercel build). The stub carries a picsum avatar,
 * an invented `signature` and hash-derived follower counts. Blindly upserting it — as
 * this function used to — destroyed the real profile of every user who logged in
 * against the deployment, and nothing in the row recorded that it had been replaced.
 *
 * So: a stub only fills fields that are currently empty, and never touches an avatar
 * that is already set. A real profile still overwrites, but keeps an existing avatar
 * when the provider omits one rather than blanking the picture.
 */
export async function upsertAccountFromProfile(profile) {
  const username = profile.username.toLowerCase();
  const data = {
    username,
    secUid: profile.secUid,
    tiktokId: profile.tiktokId,
    nickname: profile.nickname,
    avatarLarger: profile.avatarLarger,
    avatarMedium: profile.avatarMedium,
    avatarThumb: profile.avatarThumb,
    signature: profile.signature,
    verified: !!profile.verified,
    privateAccount: !!profile.privateAccount,
    secret: !!profile.secret,
    region: profile.region,
    following: profile.followingCount ?? 0,
    follower: profile.followerCount ?? 0,
  };

  const existing = await db.account.findOne({ where: { username } });

  if (existing && profile.isStub) {
    // Fill the gaps only. `following`/`follower` are deliberately excluded: the stub
    // derives them from a hash, and writing them would also move the follow-checker's
    // anchor to a number that has nothing to do with the real account.
    const fill = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'username' || key === 'following' || key === 'follower') continue;
      const current = existing[key];
      const empty = current === null || current === undefined || current === '';
      if (empty && value !== null && value !== undefined && value !== '') fill[key] = value;
    }
    if (Object.keys(fill).length === 0) return existing;
    return db.account.upsert({ where: { username }, create: data, update: fill });
  }

  if (existing && !data.avatarLarger && existing.avatarLarger) {
    // The provider answered but had no avatar for this account. Keep the one we have
    // instead of clearing the picture.
    delete data.avatarLarger;
  }

  return db.account.upsert({
    where: { username },
    create: data,
    update: data,
  });
}

/**
 * Has this (user, order, account) already been credited?
 *
 * Deliberately not filtered by history type, matching Laravel exactly.
 */
async function alreadyCredited(userId, order, account) {
  const hit = await db.coinsHistory.findOne({
    where: {
      userId,
      orderId: order.id,
      ...accountMatch('CoinsHistory', account),
    },
    select: { id: true },
  });
  return !!hit;
}

/**
 * Cancel an order.
 * Mirrors CancelOrderJob: skip if it is already finished, write the human-readable
 * message (Laravel stores the message, not the enum value — `Order::
 * normalizedCancelReason()` maps it back), and promote whatever was queued behind it.
 */
async function cancelOrder(orderId, message, code) {
  const order = await db.order.findOne({ where: { id: orderId } });
  if (!order) return;

  const settled = [OrderStatus.Cancelled, OrderStatus.Completed];
  if (settled.includes(order.status)) return;

  await db.order.update({
    where: { id: order.id },
    data: {
      status: OrderStatus.Cancelled,
      reason: message ?? code ?? null,
      adminCanceled: false,
    },
  });

  await promoteNextQueuedOrder(order.userId, order.url).catch(() => {});
}

function failure({ already }) {
  return {
    is_success: false,
    coins_earned: 0,
    already,
    need_relogin: false,
    is_unavailable: false,
  };
}

export { alreadyCredited, cancelOrder };
