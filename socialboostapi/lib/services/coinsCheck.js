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
import { getPostInfo as getPlatformPost } from './posts';
import { normalizePlatform, PLATFORM_LABELS } from './platforms';
import { getProfileInfo as getPlatformProfile } from './profiles';
import { err } from '../errors';
import { completeOrder, promoteNextQueuedOrder } from './orderLifecycle';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The provider profile for an Account row, on the platform that row belongs to.
 *
 * Every counter check below compares a *live* number to a stored anchor, and the
 * account being measured may be a TikTok or an Instagram one. Importing `tiktok.js`
 * directly (as this file used to) meant an Instagram account was queried against the
 * TikTok scraper: the call returned null, the check bailed out, and every Instagram
 * task silently refused to pay. The platform lives on the account row, so that is
 * what selects the provider.
 *
 * `secUid` is only meaningful to the TikTok provider (Instagram keys on the handle),
 * so passing it through is harmless for Instagram.
 */
function profileFor(account) {
  if (!account) return Promise.resolve(null);
  return getPlatformProfile(
    account.platform || 'tiktok',
    account.username,
    account.secUid,
  );
}

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
  // Named after the network the task was actually placed on — a hard-coded "TikTok" in
  // this message told an Instagram or Facebook user to go looking on the wrong app.
  if (!account) {
    throw err.userNotFound(`${PLATFORM_LABELS[normalizePlatform(body.platform)]} account not found.`);
  }

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
  // A like is verified against the target post's live count, on the network the
  // order belongs to. `account` is the resolved viewer row, whose platform is the
  // most reliable source when an older order row has no platform column.
  const platform = normalizePlatform(
    order.account?.platform ?? account?.platform ?? order.platform,
  );
  const post = await getPlatformPost(platform, order.url);

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

  // Live count for the viewer account, on the viewer's own platform.
  const profile = await profileFor(account);

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

  const orderPlatform = normalizePlatform(order.platform ?? account.platform);

  if (previous >= current) {
    // The order owner may have deleted or privatised their account. Laravel only
    // cancels when a provider *successfully reported* the profile as unavailable
    // or secret — a total outage must not cancel anything, because it says nothing
    // about the account. This port's provider returns null for both cases, so the
    // safe equivalent is: cancel only on a positive "this account is private".
    //
    // The target is resolved through its own Account row, not by handle alone: the
    // order owner may be on a different network than the viewer, and a handle-only
    // lookup would ask the wrong provider (and could match a different person).
    // The row is then re-read by id anyway, so the fallback only needs to be
    // platform-scoped to avoid matching the owner's namesake on another network.
    const ownerAccount = order.accountId
      ? await db.account.findOne({ where: { id: order.accountId } })
      : await db.account.findOne({
          where: { username: String(order.username).toLowerCase(), platform: orderPlatform },
        });
    const ownerProfile = await profileFor(ownerAccount);
    if (ownerProfile && (ownerProfile.secret || ownerProfile.privateAccount)) {
      return {
        credited: false,
        unavailable: true,
        code: OrderCancelCode.UnavailableAccount,
        message: `${PLATFORM_LABELS[orderPlatform]} account is unavailable`,
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
      // Scoped by platform: a TikTok anchor and an Instagram anchor for the same handle
      // are two different rows, and collapsing them would compare the viewer's TikTok
      // following count against an Instagram baseline.
      where: { username: account.username, platform: normalizePlatform(account.platform) },
      create: {
        platform: normalizePlatform(account.platform),
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
    profileInfo ?? (await profileFor(account));
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

  // The legacy branch is scoped by platform wherever the model records one. Rows written
  // before `platform` existed have no value, and `{ platform: { not: <p> } }` would skip
  // them — so the platform clause is only added when the field is actually part of the
  // model, and a missing value on the row is tolerated by matching on username alone.
  const legacy = { accountId: null, [usernameField]: account.username };
  if (account.platform && SUPPORTS_PLATFORM.has(modelName)) {
    legacy.platform = normalizePlatform(account.platform);
  }

  return {
    OR: [{ accountId: account.id }, legacy],
  };
}

/** Models that carry a `platform` field — see lib/models/Account.js. */
const SUPPORTS_PLATFORM = new Set(['FollowCount', 'LikesCount']);

/**
 * Resolve (or lazily create) the caller's linked account row.
 *
 * `body.platform` scopes every lookup when the client sends it. Without it the
 * searches are handle-only, which is ambiguous the moment a second network exists:
 * `@demo` is a different person on TikTok and Instagram, so a handle-only match can
 * hand the checker the other platform's row — and then the wrong provider is queried
 * for the live count and the task never verifies.
 */
export async function resolveAccount(body) {
  const username = body.tt_username || body.username || body.profile_username || null;
  const secUid = body.sec_uid || null;
  const platform = body.platform ? String(body.platform).toLowerCase() : null;
  const scoped = (extra) => (platform ? { platform, ...extra } : extra);

  if (secUid) {
    const bySec = await db.account.findOne({ where: scoped({ secUid }) });
    if (bySec) return bySec;
  }
  if (username) {
    const lower = String(username).toLowerCase();

    // Mirrors AuthService::getAccountInfo — the username branch only considers
    // rows that already carry a sec_uid; a bare username with no sec_uid is
    // treated as unresolved and re-fetched from the provider.
    const byName = await db.account.findOne({
      where: scoped({ username: lower, secUid: { not: null } }),
    });
    if (byName) return byName;

    const profile = await getPlatformProfile(platform || 'tiktok', lower, secUid);
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

  // Which network this row belongs to.
  //
  // The profile carries it because Instagram and TikTok have different providers
  // (see `lib/services/profiles.js`), and the same handle can exist on both as two
  // different people. Without this the row would default to TikTok and the app
  // would serve the TikTok picture for an Instagram account.
  const platform = profile.platform || 'tiktok';

  const data = {
    platform,
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
    // Total likes the account has received. `null` — not 0 — when the network does not
    // expose it, because the client renders "—" for null and a confident 0 would be a
    // lie (Instagram and Facebook have no such figure; see lib/services/instagram.js).
    //
    // This key was missing from the persisted set, so the providers' `likeCount` never
    // reached the row: `accountResourceV2` read `a.heartCount ?? null`, always got null,
    // and every profile rendered "—" even when the provider had supplied a number.
    heartCount: profile.likeCount ?? null,
  };

  // Match on platform AND username. Matching the handle alone would find the
  // TikTok row for an Instagram account — the handle is only unique per platform.
  const where = { platform, username };
  const existing = await db.account.findOne({ where });

  if (existing && profile.isStub) {
    // Fill the gaps only. `following`/`follower` are deliberately excluded: the stub
    // derives them from a hash, and writing them would also move the follow-checker's
    // anchor to a number that has nothing to do with the real account.
    const fill = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'username' || key === 'platform' || key === 'following' || key === 'follower' || key === 'heartCount') continue;
      const current = existing[key];
      const empty = current === null || current === undefined || current === '';
      if (empty && value !== null && value !== undefined && value !== '') fill[key] = value;
    }
    if (Object.keys(fill).length === 0) return existing;
    const saved = await db.account.upsert({ where, create: data, update: fill });
    mirrorInBackground(platform, username, existing.avatarLarger || data.avatarLarger, existing.avatarMirrored);
    return saved;
  }

  if (existing && !data.avatarLarger && existing.avatarLarger) {
    // The provider answered but had no avatar for this account. Keep the one we have
    // instead of clearing the picture.
    delete data.avatarLarger;
  }

  const saved = await db.account.upsert({
    where,
    create: data,
    update: data,
  });

  // The account now holds the provider's picture URL — but every one of those CDNs
  // signs its links and they expire (TikTok in ~2 days, Instagram sooner). Nothing
  // used to populate the mirror collection, so `/api/v6/avatar/<platform>/<username>`
  // always fell through to a 302 at an expiring URL and the picture eventually broke.
  // Store the bytes now, while the URL is fresh, so the client has one stable link
  // that also works on a deployment with no scraping key.
  mirrorInBackground(
    platform,
    username,
    saved?.avatarLarger ?? data.avatarLarger,
    saved?.avatarMirrored ?? existing?.avatarMirrored,
  );

  return saved;
}

/**
 * Kick off an avatar download without blocking the caller.
 *
 * Deliberately not awaited: `upsertAccountFromProfile` sits on the login and lookup
 * hot path, and a CDN round-trip there would add hundreds of milliseconds to a
 * request the user is staring at. A failed mirror costs nothing — the upstream URL
 * is still stored and still works until it expires.
 */
function mirrorInBackground(platform, username, url, alreadyMirrored) {
  if (alreadyMirrored) return; // stable bytes already stored; do not re-download
  if (!url || typeof url !== 'string') return;
  if (!/^https?:\/\//i.test(url)) return;
  // The offline stub's placeholder is not a real picture and must never be baked in.
  if (url.includes('picsum.photos')) return;

  import('./avatar')
    .then(({ mirrorAvatar }) => mirrorAvatar(platform, username, url))
    .catch(() => {
      /* cosmetic only — never let a mirror failure surface as a request error */
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
