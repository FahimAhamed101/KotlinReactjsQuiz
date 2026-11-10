// Facebook profile data provider.
//
// Sits beside `tiktok.js` and `instagram.js` and speaks the same interface, so every
// caller (login, the pre-sign-in lookup, the task checker) can ask for "the profile for
// this handle" without caring which network it came from.
//
// Facebook is the odd one out in a way worth spelling out, because it changes what a
// "handle" even is:
//
//   - TikTok and Instagram users have a username. Facebook users often do not: a page
//     has a vanity slug (`/facebook`), a personal profile frequently only has a numeric
//     id (`/profile.php?id=100064860875397`). Both forms are accepted here, and a
//     numeric handle is rebuilt into the `profile.php?id=` URL by
//     `profileUrl()` in `platforms.js`.
//   - The scraper takes a **URL**, not a handle, so the handle is expanded first.
//   - The same endpoint serves pages and personal profiles — `/page/details` answers
//     for `facebook.com/facebook` (a page) and `facebook.com/zuck` (a profile) alike,
//     reporting `type` as `page` for both. That is why there is one path below rather
//     than a page/profile split.
//
// Env:
//
//   FACEBOOK_RAPID_HOST   e.g. "facebook-scraper3.p.rapidapi.com"
//   FACEBOOK_RAPID_KEY    the RapidAPI key (falls back to RAPID_API_KEY)
//   FACEBOOK_RAPID_PATH   optional endpoint path override, defaults to "/page/details"
//
// If no host is configured the module reports itself as not-live, and callers surface an
// honest "not configured" error rather than inventing a profile.

import { Platform, profileUrl } from './platforms';

/** True when a Facebook scraping provider is configured. */
export function hasLiveProvider() {
  return facebookHost() !== null && facebookKey().length > 0;
}

function facebookHost() {
  const host = (process.env.FACEBOOK_RAPID_HOST || '').trim();
  return host ? host.replace(/^https?:\/\//i, '').replace(/\/+$/, '') : null;
}

function facebookKey() {
  return (process.env.FACEBOOK_RAPID_KEY || process.env.RAPID_API_KEY || '').trim();
}

/** The endpoint path. `/page/details` answers for pages and profiles both. */
function detailsPath() {
  const configured = (process.env.FACEBOOK_RAPID_PATH || '').trim();
  return configured || '/page/details';
}

function firstString(...values) {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

/**
 * Count fields as Facebook reports them.
 *
 * `followers` and `likes` are commonly null for a page the scraper could only see
 * partially, and `following` is essentially always null for a page. Null must become 0
 * rather than NaN so the client never renders "NaN followers".
 */
function extractCount(obj, ...keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v === null || v === undefined || v === '') continue;
    const raw = typeof v === 'object' ? (v.count ?? v.total ?? null) : v;
    if (raw === null || raw === undefined || raw === '') continue;
    const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Call the scraper.
 *
 * Returns parsed JSON, or null when the endpoint does not exist, the key is not
 * subscribed to it, or the request failed — the caller treats all three as "no profile".
 */
async function rapidGet(host, path, params) {
  const url = new URL(`https://${host}${path}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  // Profile pages are heavier than a TikTok user lookup; 12s is still well inside the
  // mobile client's own timeout while giving the scraper room to render.
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: {
        'X-RapidAPI-Key': facebookKey(),
        'X-RapidAPI-Host': host,
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull the profile object out of whichever envelope the scraper used.
 *
 * Observed: `{ results: {...} }`. Tolerated: `{ data: {...} }`, `{ result: {...} }`,
 * and the fields sitting at the top level.
 */
function extractResult(json) {
  if (!json || typeof json !== 'object') return null;

  for (const node of [json.results, json.result, json.data, json.page, json]) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    // It only counts as a profile when it carries a name or an id — otherwise
    // `{ ok: true }` would be mistaken for one.
    const hasIdentity =
      firstString(node.name, node.title) !== null ||
      firstString(node.page_id, node.id, node.profile_id) !== null;
    if (hasIdentity) return node;
  }
  return null;
}

/**
 * Derive a stable handle from the canonical URL the scraper echoed back.
 *
 * Only used to *refine* the handle the user typed, never to replace it with something
 * unrecoverable: `profileUrl(handle)` must always rebuild a URL that resolves to the
 * same person. `https://www.facebook.com/zuck` → `zuck`; a `profile.php?id=N` URL keeps
 * the numeric id.
 */
function handleFromUrl(rawUrl) {
  if (!rawUrl) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return null;
  }
  const id = url.searchParams.get('id');
  if (id) return id.toLowerCase();
  const [first] = url.pathname.split('/').filter(Boolean);
  if (!first || /^\w+\.php$/i.test(first)) return null;
  return first.toLowerCase();
}

/**
 * Fetch a Facebook page or profile.
 *
 * @param {string} username a vanity slug (`zuck`) or a numeric profile/page id
 * @returns {Promise<object|null>} the normalised profile, or null when not found /
 *   not configured / the request failed.
 */
export async function getProfileInfo(username) {
  const handle = String(username || '').trim().replace(/^@/, '').toLowerCase();
  if (!handle) return null;

  const host = facebookHost();
  if (!host || !facebookKey()) return null;

  const target = profileUrl(Platform.Facebook, handle);
  if (!target) return null;

  const json = await rapidGet(host, detailsPath(), { url: target });
  if (!json) return null;

  const result = extractResult(json);
  if (!result) return null;

  // The name is the only field that must exist — without it there is nothing to show
  // and the row would render as a blank account.
  const name = firstString(result.name, result.title);
  if (!name) return null;

  // Keep the handle the user typed unless the canonical URL disagrees, in which case the
  // canonical form is the one that will still resolve next time.
  const resolved = handleFromUrl(result.url) || handle;

  const avatar = firstString(result.image, result.profile_picture, result.avatar);
  const followers = extractCount(result, 'followers', 'follower_count', 'followers_count');
  const following = extractCount(result, 'following', 'following_count');

  return {
    platform: Platform.Facebook,
    username: resolved,
    // The Account schema is TikTok-shaped. Facebook's page id goes in `tiktokId`, and
    // the handle goes in `secUid` because that is the column every order/checker path
    // resolves a target by.
    tiktokId: firstString(result.page_id, result.id, result.profile_id),
    secUid: resolved,
    nickname: name,
    avatarLarger: avatar,
    avatarMedium: avatar,
    avatarThumb: avatar,
    signature: firstString(result.intro, result.bio, result.description),
    verified: !!result.verified,
    privateAccount: false,
    secret: false,
    region: null,
    followingCount: following,
    followerCount: followers,
    // A Facebook profile payload has no total-likes figure. Null, not 0 — see Account.js.
    likeCount: null,
  };
}

/**
 * Pull a post id out of a Facebook link.
 *
 * The scraper's `/post` endpoint takes `post_id`, and accepts either the numeric id or
 * the `pfbid...` token from a share link. Passing the full URL as `url=` returns 503, so
 * extracting the id is not optional.
 */
function extractPostId(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }

  for (const key of ['post_id', 'fbid', 'story_fbid', 'id']) {
    const value = url.searchParams.get(key);
    if (value) return value;
  }

  const parts = url.pathname.split('/').filter(Boolean);
  // /<page>/posts|videos|photos|reel|photo|p/<id>
  for (let i = 0; i < parts.length - 1; i++) {
    if (['posts', 'videos', 'photos', 'reel', 'photo', 'p'].includes(parts[i])) {
      return parts[i + 1];
    }
  }
  // /share/p/<token> and /share/<token>
  if (parts[0] === 'share') return parts[2] ?? parts[1] ?? null;
  // A bare post id pasted on its own.
  if (parts.length === 1 && /^[A-Za-z0-9_-]{4,}$/.test(parts[0])) return parts[0];
  return null;
}

/**
 * Fetch a single post for a likes order.
 *
 * `GET /post?post_id=<id>` returns `reactions_count` (and a `reactions` breakdown).
 * `reactions_count` is the number a Facebook "like" order should be anchored to — it is
 * the visible engagement counter, and it is what changes when someone reacts.
 *
 * @returns {Promise<{likeCount:number, cover:string|null}|null>}
 */
export async function getPostInfo(url) {
  const host = facebookHost();
  if (!host || !facebookKey()) return null;

  const postId = extractPostId(url);
  if (!postId) return null;

  const path = (process.env.FACEBOOK_POST_PATH || '').trim() || '/post';
  const json = await rapidGet(host, path, { post_id: postId });
  const result = json?.results;
  if (!result || !firstString(result.post_id, result.id)) return null;

  return {
    likeCount: extractCount(result, 'reactions_count', 'reactions', 'likes_count', 'like_count'),
    cover: firstString(result.image, result.video_thumbnail),
  };
}

/** Mirrors the other providers so the unfollow-check job can treat all three alike. */
export async function bulkGetProfileInfo(usernames) {
  const out = new Map();
  for (const u of usernames) {
    out.set(u, await getProfileInfo(u));
  }
  return out;
}