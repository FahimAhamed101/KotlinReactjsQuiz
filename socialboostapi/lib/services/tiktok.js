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

/**
 * Every configured TikTok key, in the order they should be tried.
 *
 * A RapidAPI allowance belongs to a *subscription*, not to the account, so this
 * subscription can run out of its monthly requests while Instagram — served by a different
 * subscription on the very same key — is still perfectly fine, and the other way round.
 * More than one key is therefore the cheapest way to stay up:
 *
 *   RAPID_API_KEY    tried first (the original variable — nothing changes for a deployment
 *                    that only sets this one)
 *   RAPID_API_KEYS   optional extra keys, comma-separated, tried in order
 *
 * Deliberately parallel to `instagramKeys()` in instagram.js, so the two providers behave
 * identically and only one of them has to be understood.
 */
function rapidKeys() {
  const raw = [process.env.RAPID_API_KEY, process.env.RAPID_API_KEYS]
    .filter(Boolean)
    .join(',');
  const keys = raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  return [...new Set(keys)];
}

/**
 * The key most likely to answer, first.
 *
 * A drained key answers 429 for the rest of the month, so leaving it at the front costs a
 * wasted round trip before every lookup reaches the working key — and the verification path
 * is already close to the client's timeout. Remembering the last key that answered puts it
 * first for the remaining life of the instance; a cold start merely pays one extra request.
 */
let lastGoodKey = null;

function orderedKeys() {
  const keys = rapidKeys();
  if (!lastGoodKey) return keys;
  const i = keys.indexOf(lastGoodKey);
  if (i <= 0) return keys;
  return [keys[i], ...keys.slice(0, i), ...keys.slice(i + 1)];
}

/**
 * True when the most recent lookup failed because the provider could not be reached or
 * refused to serve us — out of quota, key not subscribed, 5xx, timeout — as opposed to
 * reaching it and finding no such account.
 *
 * Callers that would otherwise turn null into a *definitive* statement ("your username is
 * invalid", "no such account") must consult this first. During an outage those answers are
 * not merely unhelpful, they are wrong, and they lock every user out of the network — the
 * identical defect already fixed for Instagram, and the reason this flag now exists here
 * too rather than only there.
 */
let lastUnavailable = false;

export function providerUnavailable() {
  return lastUnavailable;
}

/** True when a real scraping provider is configured. */
export function hasLiveProvider() {
  return rapidKeys().length > 0;
}

/**
 * Raw provider call.
 *
 * Exported because `app/api/v6/posts/route.js` imports it to proxy the video grid.
 * It was not exported, so that route could never have worked — which is half of why
 * "add a video" had no real videos to pick from.
 *
 * Key rotation is the point of the loop below: 429 (this subscription is out of monthly
 * requests) and 403 (this key is not subscribed to this API) describe ONE key, so they move
 * on to the next rather than failing the lookup. Anything that says nothing about the
 * handle also raises the module's availability flag — see [providerUnavailable].
 */
export async function rapidGet(path, params) {
  const url = new URL(`https://${RAPID_HOST}${path}`);
  for (const [k, v] of Object.entries(params)) {
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
          'X-RapidAPI-Host': RAPID_HOST,
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

      // A failure that a different key would not fix: the scraper itself is broken.
      if (!res.ok) {
        if (res.status >= 500) lastUnavailable = true;
        return null;
      }

      const json = await res.json();
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

/**
 * Fetch a TikTok profile.
 * @returns {Promise<{username, secUid, tiktokId, nickname, avatarLarger,
 *   avatarMedium, avatarThumb, signature, verified, privateAccount, secret,
 *   region, followingCount, followerCount}|null>}
 */
export async function getProfileInfo(username, secUid = null) {
  // Cleared up front so the flag always describes THIS call: a failure two requests ago
  // must not make a later "no such user" look like an outage.
  lastUnavailable = false;

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
    // Total likes received. The live payload calls it `heartCount`, older scraper builds
    // call it `heart`, so accept either; absent means null ("unknown"), not 0.
    likeCount: stats?.heartCount ?? stats?.heart ?? null,
  };
}

/**
 * A counter the scraper actually returned, or null when it omitted the field.
 *
 * Null — never 0. Every verifier credits when the live value is above the stored baseline,
 * so coercing an unreadable counter to 0 would make the next real reading look like a rise
 * and pay for an action nobody performed.
 */
function countOrNull(...values) {
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Fetch a single post's engagement counters.
 *
 * `author` / `nickname` / `avatar` / `desc` exist so the order screen can show the buyer
 * *which* video they just pasted a link to. They come from the same payload as the
 * counters — no extra request — and were previously thrown away, which left the client
 * with a cover image and no way to say whose video it was.
 *
 * @returns {Promise<{likeCount:number, commentCount:number|null, shareCount:number|null,
 *   playCount:number|null, cover:string|null, author?:string|null, nickname?:string|null,
 *   avatar?:string|null, desc?:string|null, isStub?:boolean}|null>}
 */
export async function getPostInfo(url) {
  if (!hasLiveProvider()) {
    const seed = hashString(url);
    // `isStub` marks this as the offline placeholder, exactly as `stubProfile` does.
    // Callers that *verify* an action must refuse it: this like count is a hash of the
    // URL, not a fact about the post, so treating it as the live figure let a key-less
    // deployment "confirm" likes against an invented number.
    //
    // The other counters are null rather than invented, so share/comment/view tasks refuse
    // to pay on a key-less deployment instead of paying against a hash of the link.
    return {
      likeCount: 1000 + (seed % 90000),
      commentCount: null,
      shareCount: null,
      playCount: null,
      cover: null,
      // No real post is behind a stub, so there is no author to name. Null rather than a
      // placeholder: the preview must never dress a hash up as a real video.
      author: null,
      nickname: null,
      avatar: null,
      desc: null,
      isStub: true,
    };
  }

  const json = await rapidGet('/', { url });
  const item = json?.data;
  if (!item) return null;

  // The scraper nests the author under `author`; older responses flatten it. Both shapes
  // are read here so a schema drift on their side does not blank the preview.
  const author = item.author ?? item.authorInfo ?? {};

  return {
    likeCount: item.digg_count ?? item.statistics?.diggCount ?? 0,
    // Confirmed present on the live payload (alongside digg_count) on 2026-11-13.
    commentCount: countOrNull(item.comment_count, item.statistics?.commentCount),
    shareCount: countOrNull(item.share_count, item.statistics?.shareCount),
    playCount: countOrNull(item.play_count, item.statistics?.playCount),
    cover: item.cover ?? item.video?.cover ?? null,
    author:
      author.uniqueId ?? author.unique_id ?? item.author_unique_id ?? item.unique_id ?? null,
    nickname: author.nickname ?? author.nickName ?? item.author_nickname ?? null,
    avatar:
      author.avatarThumb ?? author.avatarMedium ?? author.avatar_thumb ?? author.avatar ?? null,
    desc: item.desc ?? item.description ?? item.title ?? null,
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
