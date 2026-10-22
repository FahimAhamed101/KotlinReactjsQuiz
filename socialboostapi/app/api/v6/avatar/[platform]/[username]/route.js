// GET /api/v6/avatar/[platform]/[username]
//
// Serves the mirrored profile picture for an account.
//
// Why a route instead of linking the CDN URL directly: TikTok, Instagram and Facebook all
// sign avatar URLs and those signatures expire — for TikTok in about two days — after which
// the URL 403s and the client renders an empty ring. Serving the stored bytes gives the app
// one stable URL that never expires, and lets a deployment without a scraping key (Vercel)
// still show real pictures, because it only needs the database it already shares.
//
// Platform is part of the path, not just the handle: `@demo` is a different person on each
// network, and a username-only path served all three the same photo.
//
// Deliberately unauthenticated: a profile picture is public data, and an image loader
// cannot compute the request signature. There is nothing here beyond an avatar that is
// already visible on the public profile.
//
// This handler never answers 500. A picture is cosmetic, and a 500 makes the client treat
// the whole avatar as broken; falling through to the upstream URL (or a 404 the client
// renders as initials) is always the better outcome.

import { getMirroredAvatar } from '@/lib/services/avatar';
import { normalizePlatform } from '@/lib/services/platforms';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  let platform = 'tiktok';
  let username = '';

  try {
    platform = normalizePlatform(params.platform);
    username = decodeURIComponent(params.username || '').toLowerCase();
    if (!username) return new Response('Not found', { status: 404 });

    const mirrored = await getMirroredAvatar(platform, username);
    if (mirrored && mirrored.data && mirrored.data.length > 0) {
      return new Response(mirrored.data, {
        status: 200,
        headers: {
          'Content-Type': mirrored.contentType,
          // A day of browser caching, a week of staleness tolerance. The picture changes
          // rarely and a stale one is far better than a broken one.
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        },
      });
    }

    // No mirror yet: hand the client the upstream URL if we have a usable one, so a
    // brand-new account still shows a picture instead of an empty ring.
    const account = await db.account.findOne({ where: { platform, username } });
    const upstream = account?.avatarLarger;
    if (upstream && /^https?:\/\//i.test(upstream) && !upstream.includes('picsum.photos')) {
      return Response.redirect(upstream, 302);
    }

    return new Response('Not found', { status: 404 });
  } catch (e) {
    // Log for diagnosis but never surface a 500 to an image loader.
    console.error(`[avatar] ${platform}/${username} failed:`, e?.message ?? e);
    return new Response('Avatar unavailable', { status: 404 });
  }
}
