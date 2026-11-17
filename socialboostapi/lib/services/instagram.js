// Instagram profile data provider.
//
// Sits beside `tiktok.js` and speaks the same interface, so every caller (login,
// lookup, the task checker) can ask for "the profile for this handle" without
// caring which network it came from.
//
// Why this is separate from `tiktok.js` rather than folded into it:
//
//   - TikTok and Instagram have entirely different API hosts, response shapes and
//     identifiers. `tiktok.js` returns `secUid`/`tiktokId`; Instagram has a numeric
//     `pk` and a `full_name`. Merging them produced one file with two shapes and a
//     pile of `if (platform === ...)` branches.
//   - The RapidAPI subscription is per-API, not per-account. The account's key works
//     for the TikTok scraper but every Instagram scraper answers `403 You are not
//     subscribed to this API` until that specific API is subscribed to. So the two
//     providers must be able to be "live" independently.
//
// The provider chain below tries several endpoint shapes and several response
// shapes, because Instagram scrapers on RapidAPI disagree about both. The first
// one that returns a usable profile wins. Which shapes are tried is driven by
// env, so subscribing to a different API later is a `.env` change, not a code
// change.
//
// Env:
//
//   INSTAGRAM_RAPID_HOST   e.g. "instagram-scraper-api.p.rapidapi.com"
//   INSTAGRAM_RAPID_KEY    the RapidAPI key (falls back to RAPID_API_KEY)
//   INSTAGRAM_RAPID_PATH   optional endpoint path override, e.g. "/v1/info"
//
// If no host is configured the module reports itself as not-live, and callers
// surface an honest "not configured" error rather than inventing a profile.

import { Platform } from './platforms';

/** True when an Instagram scraping provider is configured. */
export function hasLiveProvider() {
  return instagramHost() !== null && instagramKeys().length > 0;
}

function instagramHost() {
  const host = (process.env.INSTAGRAM_RAPID_HOST || '').trim();
  return host ? host.replace(/^https?:\/\//i, '').replace(/\/+$/, '') : null;
}

/**
 * Every configured Instagram key, in the order they should be tried.
 *
 * A RapidAPI allowance belongs to a *subscription*, not to the account, so one API can
 * run out of its monthly requests while everything else on the same key is fine. That is
 * exactly what happened here: the Instagram subscription hit its monthly cap and the
 * whole Instagram sign-in and verification path stopped, even though the same key was
 * still happily serving Facebook. A second subscription on a second key is the cheapest
 * way to stay up, so more than one key may be configured:
 *
 *   INSTAGRAM_RAPID_KEY    tried first (the original variable — nothing changes for a
 *                          deployment that only sets this one)
 *   INSTAGRAM_RAPID_KEYS   optional extra keys, comma-separated, tried in order
 *
 * RAPID_API_KEY is a last resort, kept for an operator who sets only that. It is the
 * TikTok key and generally is *not* subscribed to Instagram, so it is used only when no
 * Instagram-specific key exists at all.
 */
function instagramKeys() {
  const raw = [process.env.INSTAGRAM_RAPID_KEY, process.env.INSTAGRAM_RAPID_KEYS]
    .filter(Boolean)
    .join(',');
  const keys = raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  const unique = [...new Set(keys)];
  if (unique.length) return unique;
  const lastResort = (process.env.RAPID_API_KEY || '').trim();
  return lastResort ? [lastResort] : [];
}

/**
 * The key most likely to answer, first.
 *
 * A key that has run out of quota returns 429 for the rest of the month, so leaving it at
 * the front means paying a wasted round trip before every lookup reaches the working key
 * — and the verification path is already close to the client's timeout. Remembering the
 * last key that answered puts it first for the remaining life of the instance; a cold
 * start merely pays one extra request.
 */
let lastGoodKey = null;

function orderedKeys() {
  const keys = instagramKeys();
  if (!lastGoodKey) return keys;
  const i = keys.indexOf(lastGoodKey);
  if (i <= 0) return keys;
  return [keys[i], ...keys.slice(0, i), ...keys.slice(i + 1)];
}

/**
 * The endpoint paths to try, in order.
 *
 * These are the shapes the popular Instagram scrapers on RapidAPI actually expose.
 * The configured path wins if the operator set one — that is the escape hatch for a
 * scraper whose path is not in this list.
 */
function candidatePaths() {
  const configured = (process.env.INSTAGRAM_RAPID_PATH || '').trim();
  const paths = [];
  if (configured) paths.push(configured);
  paths.push('/v1/info', '/user_info', '/api/v1/users/web_profile_info/');
  return paths;
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------
//
// [getProfileInfo] answers `null` for two situations that are not the same thing:
//
//   * "this handle does not exist" — the user typed it wrong, and saying so is correct;
//   * "the scraper could not answer" — a 429 from an exhausted monthly quota, a 403 for
//     a key that is not subscribed, a 5xx, or a network timeout.
//
// Collapsing them cost real users: once the RapidAPI plan ran out of requests, *every*
// Instagram handle failed, and `register` relayed that to the user as
// "username: @x is invalid" (Laravel's wording for a genuinely unknown handle). A user
// with a perfectly good account was told their own username was wrong, and nobody could
// sign up on Instagram or Facebook until the quota was noticed by hand.
//
// So the module records *how* the last lookup failed. Callers that would otherwise
// report a definitive negative consult [providerUnavailable] first and answer
// "try again shortly" instead of blaming the handle.
let lastUnavailable = false;

/**
 * True when the most recent [getProfileInfo] failed because the provider could not be
 * reached or refused to serve us — as opposed to answering "no such user".
 */
export function providerUnavailable() {
  return lastUnavailable;
}

/**
 * Call one RapidAPI endpoint, trying each configured key until one answers.
 *
 * Returns the parsed JSON, or null when the endpoint does not exist or every key refused.
 * The caller reads both as "try the next candidate path".
 *
 * Key rotation is the point of this function. 429 (this subscription is out of monthly
 * requests) and 403 (this key is not subscribed to this API) describe ONE key, so they
 * move on to the next rather than failing the lookup — that is what keeps a single
 * drained subscription from taking Instagram down. Anything that says nothing about the
 * handle also raises the module's availability flag — see [providerUnavailable].
 */
async function rapidGet(host, path, params) {
  const url = new URL(`https://${host}${path}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }

  let allRefused = false;

  for (const key of orderedKeys()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        headers: {
          'X-RapidAPI-Key': key,
          'X-RapidAPI-Host': host,
        },
        signal: controller.signal,
        cache: 'no-store',
      });

      if (res.status === 429 || res.status === 403) {
        // Out of requests, or not subscribed to this API. Another key may be perfectly
        // healthy, so keep going instead of giving up on the lookup.
        allRefused = true;
        continue;
      }

      if (!res.ok) {
        // A 404 only means this *candidate path* is not the one the configured scraper
        // exposes — nothing about the handle, nothing about the key. A 5xx is the scraper
        // itself being broken, which a different key would not fix.
        if (res.status >= 500) lastUnavailable = true;
        return null;
      }

      const text = await res.text();
      if (!text) return null;
      const json = JSON.parse(text);
      lastGoodKey = key;
      return json;
    } catch {
      // Aborted by the timeout, DNS failure, TLS failure — no answer at all.
      lastUnavailable = true;
    } finally {
      clearTimeout(timer);
    }
  }

  // Every key was refused. Callers must not read that as "no such account".
  if (allRefused) lastUnavailable = true;
  return null;
}

// ---------------------------------------------------------------------------
// Response shape normalisation
// ---------------------------------------------------------------------------

/**
 * Pull the user object out of whichever envelope the scraper used.
 *
 * Observed shapes:
 *   { data: { user: {...} } }              (Instagram Graph-ish)
 *   { data: { username, full_name, ... } }  (instagram-scraper-style)
 *   { user: {...} }
 *   { user_data: {...} }
 *   { data: {...} }
 *   { ...fields at the top level... }
 *
 * @returns {object|null}
 */
function extractUser(json) {
  if (!json || typeof json !== 'object') return null;

  const candidates = [
    json?.data?.user,
    json?.data?.user_data,
    json?.data?.userData,
    json?.user_data,
    json?.userData,
    json?.user,
    json?.data?.graphql?.user,
    json?.data,
    json,
  ];

  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    // A candidate only counts when it looks like a profile: it must carry a handle
    // or an id. Otherwise `{ data: { ok: true } }` would be mistaken for a user.
    const hasIdentity =
      firstString(c.username, c.unique_id, c.uniqueId, c.user_name, c.handle) !== null ||
      firstString(c.pk, c.id, c.pk_id, c.userId, c.user_id) !== null;
    if (hasIdentity) return c;
  }
  return null;
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
 * The profile picture, whichever field the scraper used.
 *
 * Instagram's CDN serves the avatar under several names depending on the API:
 * `profile_pic_url_hd`, `profile_pic_url`, `hd_profile_pic_url_info.url`,
 * `profile_pic_url_info.url`, `avatar`, `avatarUrl`, `image`.
 */
function extractAvatar(user) {
  const direct = firstString(
    user.profile_pic_url_hd,
    user.profile_pic_url,
    user.hd_profile_pic_url,
    user.avatar,
    user.avatarUrl,
    user.avatar_url,
    user.image,
    user.profile_image_url,
  );
  if (direct) return direct;

  // The nested `*_info` variants carry a `url` field.
  for (const key of ['hd_profile_pic_url_info', 'profile_pic_url_info', 'avatar_info']) {
    const info = user[key];
    if (info && typeof info === 'object') {
      const url = firstString(info.url, info.uri);
      if (url) return url;
    }
  }
  return null;
}

function extractCount(user, ...keys) {
  for (const k of keys) {
    const v = user[k];
    if (v === null || v === undefined || v === '') continue;
    // Some scrapers nest the number: instagram-looter2 returns
    // `edge_followed_by: { count: 14 }` and `edge_follow: { count: 8 }`, so
    // reading the field directly yields an object and parseInt() gives NaN — the
    // count silently became 0 and the profile showed "0 followers" for everyone.
    const raw = (typeof v === 'object') ? (v.count ?? v.total ?? v.count_value ?? null) : v;
    if (raw === null || raw === undefined || raw === '') continue;
    const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Fetch an Instagram profile.
 *
 * @param {string} username the handle, without the `@`
 * @returns {Promise<{username, tiktokId, secUid, nickname, avatarLarger, avatarMedium,
 *   avatarThumb, signature, verified, privateAccount, secret, region,
 *   followingCount, followerCount, platform}|null>}
 */
export async function getProfileInfo(username) {
  const handle = String(username || '').trim().replace(/^@/, '').toLowerCase();
  if (!handle) return null;

  // Cleared up front so the flag always describes THIS call: a failure two requests ago
  // must not make a later "no such user" look like an outage.
  lastUnavailable = false;

  const host = instagramHost();
  if (!host || instagramKeys().length === 0) return null;

  for (const path of candidatePaths()) {
    const json = await rapidGet(host, path, { username: handle });
    if (!json) continue;

    const user = extractUser(json);
    if (!user) continue;

    const resolved = (
      firstString(user.username, user.unique_id, user.uniqueId, user.user_name, user.handle) || handle
    ).toLowerCase();

    const id = firstString(user.pk, user.id, user.pk_id, user.userId, user.user_id);
    const fullName = firstString(user.full_name, user.fullName, user.name, user.nickname);
    const avatar = extractAvatar(user);

    return {
      platform: Platform.Instagram,
      username: resolved,
      // The Account schema is TikTok-shaped, so these two carry the Instagram
      // equivalents: the numeric id in `tiktokId`, and the handle in `secUid` because
      // that is the column every order/checker path resolves a target by.
      tiktokId: id,
      secUid: resolved,
      nickname: fullName || resolved,
      avatarLarger: avatar,
      avatarMedium: avatar,
      avatarThumb: avatar,
      signature: firstString(user.biography, user.bio, user.signature, user.description),
      verified: !!(user.is_verified ?? user.verified),
      privateAccount: !!(user.is_private ?? user.privateAccount),
      secret: false,
      region: firstString(user.country, user.region),
      followingCount: extractCount(user, 'following_count', 'followingCount', 'edge_follow', 'following'),
      followerCount: extractCount(user, 'follower_count', 'followerCount', 'edge_followed_by', 'followers'),
      // Instagram's profile payload carries no total-likes figure. Left null rather than
      // summed from the handful of posts we can see, which would be a wrong number
      // presented as a real one — the client shows "—" for null.
      likeCount: null,
    };
  }

  return null;
}

/**
 * Fetch a single post for a likes order.
 *
 * instagram-looter2 exposes `GET /post?url=<post url>`. The `code`/`shortcode` params
 * look obvious but answer "Invalid Request Parameters" for a real shortcode — the API
 * wants the **whole URL**. A live post returns
 * `edge_media_preview_like: { count: 272384 }`, which `extractCount` already unwraps.
 *
 * @param {string} url a canonical instagram.com/p/<code>/ link
 * @returns {Promise<{likeCount:number, cover:string|null}|null>}
 */
/**
 * Like extractCount, but null when the field is absent.
 *
 * extractCount returns 0 for a missing key, which is right for a *displayed* profile count
 * but wrong for a verification baseline: 0 means "any later value is provably a rise", so a
 * provider that stopped returning the field would pay for every task. Null makes the caller
 * refuse instead.
 */
function extractCountOrNull(obj, ...keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v === null || v === undefined || v === '') continue;
    const raw = typeof v === 'object' ? (v.count ?? v.total ?? v.count_value ?? null) : v;
    if (raw === null || raw === undefined || raw === '') continue;
    const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export async function getPostInfo(url) {
  const target = absolutePostUrl(url);
  const host = instagramHost();
  if (!target || !host || instagramKeys().length === 0) return null;

  const path = (process.env.INSTAGRAM_POST_PATH || '').trim() || '/post';
  const json = await rapidGet(host, path, { url: target });
  // `status: false` is how this API reports "not found" without an HTTP error.
  if (!json || json.status === false) return null;

  const likeCount = extractCount(
    json,
    'edge_media_preview_like',
    'edge_liked_by',
    'like_count',
    'likes_count',
  );
  return {
    likeCount,
    // Instagram publishes comment counts and (for video) view counts, but no share count.
    // A shares order on Instagram is therefore refused rather than paid on trust.
    commentCount: extractCountOrNull(
      json,
      'edge_media_to_comment',
      'comment_count',
      'comments_count',
      'edge_media_to_parent_comment',
    ),
    shareCount: null,
    playCount: extractCountOrNull(json, 'video_view_count', 'video_play_count', 'view_count'),
    cover: firstString(json.display_url, json.thumbnail_src, json.media_preview),
    // For the order preview — see the same block in tiktok.js.
    author: firstString(json.owner?.username, json.username),
    nickname: firstString(json.owner?.full_name, json.full_name),
    avatar: firstString(json.owner?.profile_pic_url, json.owner?.profile_pic_url_hd),
    desc: firstString(
      json.edge_media_to_caption?.edges?.[0]?.node?.text,
      json.caption,
      json.title,
    ),
  };
}

function absolutePostUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    // Only instagram links are ever sent upstream.
    const parsed = new URL(withScheme);
    return /(^|\.)instagram\.com$/i.test(parsed.hostname) ? withScheme : null;
  } catch {
    return null;
  }
}

/**
 * Bulk profile fetch, used by the unfollow-check job.
 *
 * Mirrors `bulkGetProfileInfo` in `tiktok.js` so the checker can treat both
 * platforms identically.
 */
export async function bulkGetProfileInfo(usernames) {
  const out = new Map();
  for (const u of usernames) {
    out.set(u, await getProfileInfo(u));
  }
  return out;
}
