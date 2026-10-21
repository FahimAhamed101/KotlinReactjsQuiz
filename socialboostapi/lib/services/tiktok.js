// TikTok profile/post data provider.
//
// Ported from App\Services\TikTokService + the ProfileInfoFactory / PostInfoFactory
// provider chain. The Laravel version rotates across several RapidAPI scrapers,
// tracks per-provider failure counts in `api_providers`, and applies a cool-down.
//
// This port keeps the same *interface* and the same "return null when every
// provider is down" contract — callers rely on null meaning "retryable, not a
// denial". The provider chain is simplified to one HTTP scraper plus a
// deterministic local stub used when no API key is configured.

const RAPID_HOST = process.env.RAPID_API_HOST || 'tiktok-scraper7.p.rapidapi.com';
const RAPID_KEY = process.env.RAPID_API_KEY || '';

/** True when a real scraping provider is configured. */
export function hasLiveProvider() {
  return RAPID_KEY.length > 0;
}

/**
 * Raw provider call.
 *
 * Exported because `app/api/v6/posts/route.js` imports it to proxy the video grid.
 * It was not exported, so that route could never have worked — which is half of why
 * "add a video" had no real videos to pick from.
 */
export async function rapidGet(path, params) {
  const url = new URL(`https://${RAPID_HOST}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: {
        'X-RapidAPI-Key': RAPID_KEY,
        'X-RapidAPI-Host': RAPID_HOST,
      },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a TikTok profile.
 * @returns {Promise<{username, secUid, tiktokId, nickname, avatarLarger,
 *   avatarMedium, avatarThumb, signature, verified, privateAccount, secret,
 *   region, followingCount, followerCount}|null>}
 */
export async function getProfileInfo(username, secUid = null) {
  if (!hasLiveProvider()) return stubProfile(username, secUid);

  const json = await rapidGet('/user/info', { unique_id: username, sec_uid: secUid });
  const user = json?.data?.user;
  const stats = json?.data?.stats;
  if (!user) return null;

  return {
    username: user.uniqueId ?? username,
    secUid: user.secUid ?? secUid ?? null,
    tiktokId: user.id ?? null,
    nickname: user.nickname ?? null,
    avatarLarger: user.avatarLarger ?? null,
    avatarMedium: user.avatarMedium ?? null,
    avatarThumb: user.avatarThumb ?? null,
    signature: user.signature ?? null,
    verified: !!user.verified,
    privateAccount: !!user.privateAccount,
    secret: !!user.secret,
    region: user.region ?? null,
    followingCount: stats?.followingCount ?? 0,
    followerCount: stats?.followerCount ?? 0,
  };
}

/**
 * Fetch a single post's like count.
 * @returns {Promise<{likeCount:number, cover:string|null}|null>}
 */
export async function getPostInfo(url) {
  if (!hasLiveProvider()) {
    const seed = hashString(url);
    return { likeCount: 1000 + (seed % 90000), cover: null };
  }

  const json = await rapidGet('/', { url });
  const item = json?.data;
  if (!item) return null;
  return {
    likeCount: item.digg_count ?? item.statistics?.diggCount ?? 0,
    cover: item.cover ?? item.video?.cover ?? null,
  };
}

/** Bulk profile fetch, used by the unfollow-check job. */
export async function bulkGetProfileInfo(usernames) {
  const out = new Map();
  for (const u of usernames) {
    out.set(u, await getProfileInfo(u));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Offline stub
// ---------------------------------------------------------------------------
//
// With no RAPID_API_KEY the server cannot see real TikTok data. Rather than
// silently failing every verification, we derive a *stable* profile from the
// username so the whole follow/like flow stays exercisable end to end in dev.
// Counts are deterministic, so a follow "verified" by the checker behaves
// consistently across restarts.
//
// This is a development affordance, NOT a production behaviour — the Laravel
// original has no such path.

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function stubProfile(username, secUid) {
  if (!username) return null;
  const seed = hashString(username);
  return {
    // Callers MUST check this before persisting. A stub carries a picsum
    // placeholder avatar, an invented signature and hash-derived counters; writing
    // it over a row that was populated by the live provider destroys the real
    // profile and there is no way to tell afterwards. That is exactly how the
    // deployed app (no RAPID_API_KEY) used to erase every real avatar.
    isStub: true,
    username,
    secUid: secUid ?? `MS4wLjABAAAA${seed.toString(36)}`,
    tiktokId: String(7000000000000000000n + BigInt(seed)),
    nickname: username,
    avatarLarger: `https://picsum.photos/seed/${encodeURIComponent(username)}/200`,
    avatarMedium: `https://picsum.photos/seed/${encodeURIComponent(username)}/100`,
    avatarThumb: `https://picsum.photos/seed/${encodeURIComponent(username)}/50`,
    signature: 'TTBoost dev stub profile',
    verified: false,
    privateAccount: false,
    secret: false,
    region: 'US',
    followingCount: 100 + (seed % 400),
    followerCount: 500 + (seed % 5000),
  };
}
