// GET /api/v6/posts/url
// POST /api/v6/posts/url
//
// Ported from PostController::getByUrl (GET) and PostControllerV2::getByUrl (POST).
//
// GET proxies the TikTok scraper for a single post by its URL.
// POST is the like-task entry point: it fetches the current like count, stores it as
// a baseline in like_counts, and returns the row. The checker later compares the live
// count against this baseline to verify the like.

import { handle, success } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { readJson, requireInt, requireString, tiktokUsername } from '@/lib/validate';
import { err } from '@/lib/errors';
import { hasLiveProvider, rapidGet } from '@/lib/services/tiktok';
import { getPostInfo as getPlatformPost } from '@/lib/services/posts';
import { normalizePlatform } from '@/lib/services/platforms';
import { resolveAccount } from '@/lib/services/coinsCheck';
import { actionOfOrder, isPostAction, metricValue } from '@/lib/services/postActions';
import { LikesCount } from '@/lib/models';
import { nextId } from '@/lib/models';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  await guard(request, {}, { signature: true });

  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  if (!url) throw err.unknown('url is required.');

  if (!hasLiveProvider()) {
    return success({
      code: 0,
      data: {
        video: null,
        author: { uniqueId: 'demo_user', nickname: 'Demo User' },
        statistics: { diggCount: 1000, commentCount: 50, shareCount: 10 },
      },
    });
  }

  const data = await rapidGet('/', { url });
  return success(data ?? {});
});

export const POST = handle(async (request) => {
  const body = await readJson(request);
  await guard(request, body, { signature: true });

  const orderId = requireInt(body, 'order_id');
  const ttUsername = tiktokUsername(body, 'tt_username');
  const secUid = body.sec_uid || null;
  const url = requireString(body, 'url', { max: 500 });

  // `body.platform` is the viewer's network. The like baseline must be fetched from
  // that network's provider, otherwise an Instagram post is read by the TikTok scraper
  // and stored as a zero baseline that can never be exceeded.
  const platform = normalizePlatform(body.platform);
  const info = await getPlatformPost(platform, url);

  // Only a baseline that was actually READ may be stored. There were two ways to poison it:
  //
  //   * No scraping key configured -> the provider answers with the offline stub, whose
  //     `likeCount` is a hash of the URL. That invention then becomes the "before" value the
  //     checker compares against, so the next real reading can look like a huge jump in
  //     likes and pay out on a task nobody performed.
  //   * The provider failed (deleted post, scraper down) -> `info` is null, and the old
  //     `info?.likeCount ?? 0` stored a ZERO baseline. The checker credits whenever the live
  //     count exceeds the baseline, so a zero row means *any* nonzero count pays instantly.
  //
  // A genuine 0-like post is different: there `info.likeCount` really is 0, and one like
  // taking it to 1 is a real credit. So test `info` itself, not the number.
  if (!info || info.isStub) {
    throw err.unknown(
      info?.isStub
        ? `No ${platform} provider is configured, so this post's like count cannot be read.`
        : 'Could not read the post to take a like baseline.',
    );
  }

  // Which counter proves this task. The ORDER decides — a like is measured on the post's
  // like count, a share on its share count, a comment on its comment count, a view on its
  // play count — so the baseline is always written against the counter that will be checked.
  const order = await db.order.findOne({ where: { id: orderId } });
  if (!order) throw err.unknown('Order not found.');
  const action = actionOfOrder(order);
  if (!isPostAction(action)) throw err.unknown('This order is not a post task.');

  const lastCount = metricValue(info, action);
  // A counter the provider did not return cannot be baselined, and storing 0 here is exactly
  // how a provider outage once made every later reading look like a rise. Refuse instead —
  // the task simply cannot be verified on this network, which is better than paying blind.
  if (lastCount === null) {
    throw err.unknown(
      `This post does not expose a ${action} count, so a ${action} task cannot be verified.`,
    );
  }

  // Same platform, for the same reason: the viewer's Account row has to be the one that
  // belongs to this network, or the baseline is attributed to a different person.
  const account = await resolveAccount({ tt_username: ttUsername, sec_uid: secUid, platform });

  const id = await nextId('like_counts');
  const row = await LikesCount.create({
    id,
    orderId,
    platform,
    url,
    lastCount,
    // Which counter this baseline belongs to, so the checker compares like-with-like.
    metric: action,
    ttUsername,
    accountId: account?.id ?? null,
    isLiked: false,
  });

  return success(row);
});
