// GET /api/v6/posts
//
// Ported from PostController::index. Proxies the TikTok scraper to fetch a user's
// recent posts. The response is forwarded verbatim so the client can render the
// video grid without learning a new shape.
//
// Query params: unique_id (required), count (default 30), cursor (default 0)

import { handle, success } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { err } from '@/lib/errors';
import { hasLiveProvider, rapidGet } from '@/lib/services/tiktok';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  await guard(request, {}, { signature: true });

  const { searchParams } = new URL(request.url);
  const uniqueId = searchParams.get('unique_id');
  const count = Math.min(parseInt(searchParams.get('count') ?? '30', 10), 100);
  const cursor = parseInt(searchParams.get('cursor') ?? '0', 10);

  if (!uniqueId) throw err.unknown('unique_id is required.');

  if (!hasLiveProvider()) {
    // When no RapidAPI key is set, return a deterministic stub so the client still
    // renders a grid and the endpoint is testable without a live provider.
    return success({
      code: 0,
      data: {
        videos: [],
        cursor: cursor + count,
        hasMore: false,
      },
    });
  }

  const data = await rapidGet('/user/posts', { unique_id: uniqueId, count, cursor });
  return success(data ?? {});
});
