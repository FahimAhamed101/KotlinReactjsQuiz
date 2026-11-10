// Platform dispatch for **single post** lookups.
//
// `profiles.js` does this for profiles; a likes order needs the same thing for posts,
// because the order is anchored to that post's current like/reaction count. Before this
// module existed every consumer imported `getPostInfo` from `tiktok.js` directly, so an
// Instagram or Facebook post was queried against the TikTok scraper, returned null, and
// the order was refused with "Could not read that video".
//
// Providers (verified against the live APIs):
//
//   TikTok     tiktok.js getPostInfo(url)              -> digg_count
//   Instagram  GET /post?url=<post url>               -> edge_media_preview_like.count
//   Facebook   GET /post?post_id=<id or pfbid token>  -> reactions_count
//
// Every function takes `platform` first and falls back to TikTok for an absent/unknown
// value, so older clients that never sent the field keep behaving exactly as before.

import { Platform, normalizePlatform, parsePostUrl, postUrl, linkFormatHint } from './platforms';
import { getPostInfo as getTikTokPost } from './tiktok.js';
import { getPostInfo as getInstagramPost } from './instagram.js';
import { getPostInfo as getFacebookPost } from './facebook.js';
import { resolveVideoUrl } from './videoUrl.js';

export { linkFormatHint as postLinkHint };

function absoluteUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

/**
 * Resolve a pasted link to a single post.
 *
 * TikTok keeps its own resolver because short `vm.tiktok.com` links need a redirect
 * followed before the numeric video id appears. The other two use the shared parser in
 * `platforms.js`, which already understands `/p/`, `/reel/`, `?fbid=`, `/posts/`, etc.
 *
 * @returns {{username: string|null, postId: string, kind?: string}|null}
 */
export async function resolvePost(platform, raw) {
  const p = normalizePlatform(platform);
  if (p === Platform.TikTok) return resolveVideoUrl(raw);

  const direct = parsePostUrl(p, raw);
  if (direct?.postId) return direct;

  // Facebook's share sheet produces `fb.watch/...` and `/share/p/<token>` links. Following
  // the redirect is the only way to see the real post url; if it fails, refuse honestly
  // rather than storing a token that no provider can resolve.
  const url = absoluteUrl(raw);
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
    return parsePostUrl(p, res.url) ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The URL stored on the order.
 *
 * TikTok needs a rebuilt canonical `/@user/video/<id>` link because short links cannot be
 * re-fetched. Instagram and Facebook post URLs are already usable as-is, and share forms
 * cannot be reconstructed from an id alone, so those keep the resolved absolute URL.
 */
export function canonicalPostUrl(platform, post, rawUrl) {
  if (!post?.postId) return null;
  const p = normalizePlatform(platform);
  if (p === Platform.TikTok) return postUrl(p, post.postId, post.username);
  return absoluteUrl(rawUrl);
}

/**
 * @returns {Promise<{likeCount:number, cover:string|null}|null>}
 */
export async function getPostInfo(platform, url) {
  switch (normalizePlatform(platform)) {
    case Platform.Instagram:
      return getInstagramPost(url);
    case Platform.Facebook:
      return getFacebookPost(url);
    default:
      return getTikTokPost(url);
  }
}
