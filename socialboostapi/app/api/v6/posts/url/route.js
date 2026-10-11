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
import { getPostInfo, hasLiveProvider, rapidGet } from '@/lib/services/tiktok';
import { resolveAccount } from '@/lib/services/coinsCheck';
import { LikesCount } from '@/lib/models';
import { nextId } from '@/lib/models';

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

  const info = await getPostInfo(url);
  const lastCount = info?.likeCount ?? 0;

  const account = await resolveAccount({ tt_username: ttUsername, sec_uid: secUid });

  const id = await nextId('like_counts');
  const row = await LikesCount.create({
    id,
    orderId,
    url,
    lastCount,
    ttUsername,
    accountId: account?.id ?? null,
    isLiked: false,
  });

  return success(row);
});
