// TikTok video-link parsing.
//
// A likes order is anchored to ONE video: the server reads that video's current like
// count and stores it as `start_count`, then the checker compares against it later. That
// only works if `url` points at a video.
//
// The client used to send `https://www.tiktok.com/@<handle>` — a *profile* link — for
// likes orders, because the picker only ever produced a fake `post_pk` string. The
// provider cannot read a like count from a profile URL, `getPostInfo` returned null, and
// `createOrderV4` rejected the order with "Could not read that video". That is why buying
// likes for a video never worked.
//
// Parsing here also means `post_pk` no longer has to be trusted from the client: the id
// is read out of the URL the user actually pasted.

const TIKTOK_HOST = /(^|\.)tiktok\.com$/i;

/** `/@handle/video/<id>` — the canonical desktop/mobile share link. */
const PATH_VIDEO = /^\/@([A-Za-z0-9._-]+)\/video\/(\d+)/i;
/** Legacy `/v/<id>.html` share form, which carries no handle. */
const PATH_LEGACY = /^\/v\/(\d+)\.html?$/i;
/** `/t/<id>` embed form. */
const PATH_T = /^\/t\/(\d+)/i;

function safeUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const trimmed = raw.trim();
  // Accept a bare `tiktok.com/...` paste without a scheme.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

/**
 * Parse a canonical TikTok video URL.
 * @returns {{username: string|null, postId: string}|null}
 */
export function parseTikTokVideoUrl(raw) {
  const url = safeUrl(raw);
  if (!url || !TIKTOK_HOST.test(url.hostname)) return null;

  const match = url.pathname.match(PATH_VIDEO);
  if (match) return { username: match[1].toLowerCase(), postId: match[2] };

  const legacy = url.pathname.match(PATH_LEGACY) ?? url.pathname.match(PATH_T);
  if (legacy) return { username: null, postId: legacy[1] };

  return null;
}

/**
 * Resolve a pasted link to a video, following `vm.tiktok.com` / `vt.tiktok.com` short
 * links first. Returns null when the link is not a single video (a profile link, a
 * photo post, or something else entirely).
 *
 * Only tiktok.com hosts are fetched, so this cannot be used to make the server request
 * arbitrary URLs.
 */
export async function resolveVideoUrl(raw) {
  const direct = parseTikTokVideoUrl(raw);
  if (direct) return direct;

  const url = safeUrl(raw);
  if (!url || !TIKTOK_HOST.test(url.hostname)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
      },
    });
    // `res.url` is the post-redirect URL, which is where the /video/<id> lives.
    return parseTikTokVideoUrl(res.url);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The canonical URL for a parsed video — what gets stored on the order. */
export function canonicalVideoUrl(video) {
  if (!video?.postId) return null;
  return video.username
    ? `https://www.tiktok.com/@${video.username}/video/${video.postId}`
    : `https://www.tiktok.com/v/${video.postId}.html`;
}
