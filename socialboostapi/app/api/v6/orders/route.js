// GET    /api/v6/orders  — the Home task feed
// POST   /api/v6/orders  — place an order
// DELETE /api/v6/orders  — delete a pending, unpaid order
//
// GET    ported from OrderController::index -> OrderService::getOrderList
// POST   ported from V4OrderController::create -> OrderService::createNewOrderV4
// DELETE ported from V4OrderController::delete -> OrderService::deletePendingOrder

import { handle } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { readJson, requireString, optionalString, pageOf, optionalInt, requireInt } from '@/lib/validate';
import { orderResource } from '@/lib/resources';
import { getFeed } from '@/lib/services/feed';
import { createOrderV4, deletePendingOrder } from '@/lib/services/orders';
import { getProfileInfo } from '@/lib/services/tiktok';
import { upsertAccountFromProfile } from '@/lib/services/coinsCheck';
import { getInt } from '@/lib/settings';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  const user = await guard(request, {}, { signature: true });

  const params = new URL(request.url).searchParams;
  const secUid = params.get('sec_uid');
  const username = params.get('username') ? params.get('username').toLowerCase() : null;
  const page = pageOf(request, 1);

  const account = await resolveViewerAccount(secUid, username);

  // Snapshot the target account's counters so the checker has an anchor to
  // compare against. Mirrors the follow_counts upsert in getOrderList.
  if (account) {
    // Best-effort. The anchor is only needed by the *verifier* later on; if refreshing
    // it fails, the feed itself must still render.
    await refreshFollowCountAnchor(account).catch(() => {});
  }

  const perPage = await getInt('freeOrdersPerPage', 10);
  const feed = await getFeed({
    userId: user.id,
    accountId: account?.id ?? null,
    username: account?.username ?? null,
    page,
    perPage,
  });

  const items = feed.items.map((o) =>
    orderResource(
      {
        ...o,
        // Other users' orders never leak their internal counters.
        startCount: null,
        expectedCount: null,
        orderId: null,
        purchaseToken: null,
      },
      { v4: true },
    ),
  );

  return { items, has_next: feed.hasNext, page };
});

export const POST = handle(async (request) => {
  const body = await readJson(request);
  const user = await guard(request, body, { signature: true });

  requireString(body, 'sec_uid', { max: 255 });
  requireString(body, 'url', { max: 255 });
  optionalString(body, 'post_pk', { max: 255 });
  optionalInt(body, 'offer_id');
  requireString(body, 'product_id');

  const order = await createOrderV4({ user, body });
  return orderResource(order, { v4: true });
});

export const DELETE = handle(async (request) => {
  const body = await readJson(request);
  const user = await guard(request, body, { signature: true });

  requireInt(body, 'order_id');

  await deletePendingOrder(user, body.order_id);

  // The Laravel controller returns response()->noContent(), but handleApi() only
  // passes through a JsonResponse — so it actually wrapped the Response object as
  // `data`, a latent bug. Return a proper envelope instead: the Android client
  // reads `success`, and a bare 204 would be the only endpoint without it.
  return null;
});

/** Resolve the viewer's own linked TikTok account. */
async function resolveViewerAccount(secUid, username) {
  if (secUid) {
    const found = await db.account.findOne({ where: { secUid } });
    if (found) return found;
  }
  if (username) {
    const found = await db.account.findOne({ where: { username } });
    if (found) return found;

    const profile = await getProfileInfo(username, secUid);
    if (profile) return upsertAccountFromProfile(profile);
  }
  return null;
}

/**
 * Keep follow_counts honest.
 *
 * On first sight we seed BOTH counters. On later loads we only update
 * follower_count — following_count is the checker's anchor and must not be
 * overwritten, or a completed task could be re-verified forever.
 */
const ANCHOR_REFRESH_MS = 10 * 60 * 1000;

async function refreshFollowCountAnchor(account) {
  const existing = await db.followCount.findOne({ where: { username: account.username } });

  // Do NOT scrape TikTok on every feed load.
  //
  // This used to run a live profile fetch unconditionally, so simply opening the Tasks
  // tab always cost a round-trip to the scraper (measured ~3.8s warm). On a cold
  // serverless start that was enough to blow past the client's request timeout, which
  // surfaced as "Could not load tasks" even though the feed itself was ready. The
  // anchor only has to be *fresh*, not brand new, so a recent row is reused as-is.
  if (existing && Date.now() - new Date(existing.updatedAt).getTime() < ANCHOR_REFRESH_MS) {
    return;
  }

  const profile = await getProfileInfo(account.username, account.secUid).catch(() => null);
  // A scraper outage must not break the feed; the anchor simply keeps its old value.
  if (!profile) return;

  if (!existing) {
    await db.followCount.create({
      data: {
        username: account.username,
        followerCount: profile.followerCount,
        followingCount: profile.followingCount,
        lastCheckedFollowing: profile.followingCount,
        accountId: account.id,
      },
    });
    return;
  }

  await db.followCount.update({
    where: { id: existing.id },
    data: { followerCount: profile.followerCount, accountId: account.id },
  });
}
