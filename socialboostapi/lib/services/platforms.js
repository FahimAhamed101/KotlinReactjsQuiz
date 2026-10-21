// Platform metadata: URL building, URL parsing, and labels.
//
// Why this exists as its own module: the app grew up TikTok-only and the TikTok shapes
// leaked everywhere — `https://www.tiktok.com/@handle`, `/@handle/video/<id>`, `sec_uid`.
// Adding Instagram and Facebook then means touching every one of those places. Instead
// each platform's URL shape lives here once, and callers ask for it.
//
// Deliberately absent: anything that needs a network call. That is `providers.js`'s job.
// Keeping them apart is what makes this file testable without an API key.

export const Platform = {
  TikTok: 'tiktok',
  Instagram: 'instagram',
  Facebook: 'facebook',
};

/** Every platform the app understands, in the order the picker shows them. */
export const PLATFORM_ORDER = [Platform.TikTok, Platform.Instagram, Platform.Facebook];

export const PLATFORM_LABELS = {
  [Platform.TikTok]: 'TikTok',
  [Platform.Instagram]: 'Instagram',
  [Platform.Facebook]: 'Facebook',
};

/** True when the string names a platform this build knows. */
export function isPlatform(value) {
  return PLATFORM_ORDER.includes(value);
}

/** Anything unknown is treated as TikTok, so an absent field breaks nothing. */
export function normalizePlatform(value) {
  return isPlatform(value) ? value : Platform.TikTok;
}

/**
 * Hosts that are allowed to be parsed. A pasted link must belong to one of these, which
 * also means the server cannot be tricked into fetching an arbitrary URL by sending
 * `platform: 'tiktok'` with a `facebook.com` link.
 */
const HOSTS = {
  [Platform.TikTok]: /(^|\.)tiktok\.com$/i,
  [Platform.Instagram]: /(^|\.)instagram\.com$/i,
  [Platform.Facebook]: /(^|\.)(facebook\.com|fb\.watch)$/i,
};

/** App package names, so a task opens the app rather than a browser tab. */
export const ANDROID_APP_PACKAGES = {
  [Platform.TikTok]: 'com.zhiliaoapp.musically',
  [Platform.Instagram]: 'com.instagram.android',
  [Platform.Facebook]: 'com.facebook.katana',
};

function toUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function hostMatches(platform, hostname) {
  return HOSTS[platform]?.test(hostname) ?? false;
}

// --- profile links -------------------------------------------------------------------

/**
 * Canonical profile URL for a handle.
 * Facebook uses the numeric `profile.php?id=` form when the handle is not a username, so
 * an all-digit handle is rendered that way — `/demo` is not a valid Facebook profile URL.
 */
export function profileUrl(platform, username) {
  const handle = String(username ?? '').trim().replace(/^@/, '');
  if (!handle) return null;
  switch (platform) {
    case Platform.Instagram:
      return `https://www.instagram.com/${handle}/`;
    case Platform.Facebook:
      return /^\d+$/.test(handle)
        ? `https://www.facebook.com/profile.php?id=${handle}`
        : `https://www.facebook.com/${handle}`;
    default:
      return `https://www.tiktok.com/@${handle}`;
  }
}

/**
 * Pull a handle out of a pasted profile link, or null if it is not one.
 *
 * Accepts a bare handle as well, because that is what the login screen offers. Rejects a
 * link whose host belongs to another platform.
 */
export function parseProfileUrl(platform, raw) {
  const plain = String(raw ?? '').trim().replace(/^@/, '');
  if (plain && !/[\s./]/.test(plain)) return plain.toLowerCase();

  const url = toUrl(raw);
  if (!url || !hostMatches(platform, url.hostname)) return null;

  switch (platform) {
    case Platform.Instagram:
      // instagram.com/<handle>/ (story highlights and reels are not profiles)
      if (/^\/\/(reels|stories|explore)/.test(`/${url.pathname}`)) return null;
      return url.pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? null;

    case Platform.Facebook: {
      const id = url.searchParams.get('id');
      if (id) return id;
      const [first] = url.pathname.split('/').filter(Boolean);
      if (!first) return null;
      // /profile.php and friends are not handles.
      if (/^\w+\.php$/i.test(first)) return null;
      return first.toLowerCase();
    }

    default:
      return url.pathname.match(/^\/@([A-Za-z0-9._-]+)/)?.[1]?.toLowerCase() ?? null;
  }
}

// --- post links ----------------------------------------------------------------------

/**
 * Canonical URL for a single post.
 *
 * @param {string} postId  platform-native id (TikTok aweme id, Instagram shortcode,
 *   Facebook post id)
 */
export function postUrl(platform, postId, username = null) {
  if (!postId) return null;
  const handle = username ? String(username).replace(/^@/, '') : null;
  switch (platform) {
    case Platform.Instagram:
      return handle
        ? `https://www.instagram.com/p/${postId}/`
        : `https://www.instagram.com/p/${postId}/`;
    case Platform.Facebook:
      return handle && !/^\d+$/.test(handle)
        ? `https://www.facebook.com/${handle}/posts/${postId}`
        : `https://www.facebook.com/${postId}`;
    default:
      return handle
        ? `https://www.tiktok.com/@${handle}/video/${postId}`
        : `https://www.tiktok.com/v/${postId}.html`;
  }
}

/**
 * Parse a pasted post link.
 * @returns {{username: string|null, postId: string, kind: string}|null}
 */
export function parsePostUrl(platform, raw) {
  const url = toUrl(raw);
  if (!url || !hostMatches(platform, url.hostname)) return null;

  const segments = url.pathname.split('/').filter(Boolean);

  if (platform === Platform.Instagram) {
    // /p/<code>, /reel(s)/<code>, /tv/<code>, /s/<promoted>, /stories/<handle>/<code>
    const KIND = { p: 'post', reel: 'reel', reels: 'reel', tv: 'igtv', s: 'photo' };
    const kind = KIND[segments[0]];
    if (!kind || !segments[1]) return null;
    if (segments[0] === 'stories') {
      return { username: segments[1].toLowerCase(), postId: segments[2] ?? null, kind: 'story' };
    }
    return { username: null, postId: segments[1], kind };
  }

  if (platform === Platform.TikTok) {
    const video = url.pathname.match(/^\/@([A-Za-z0-9._-]+)\/video\/(\d+)/);
    if (video) return { username: video[1].toLowerCase(), postId: video[2], kind: 'video' };
    const short = url.pathname.match(/^\/v\/(\d+)\.html?$/);
    if (short) return { username: null, postId: short[1], kind: 'video' };

    // /t/<code> is a share link whose real id only appears after the redirect.
    const shareT = url.pathname.match(/^\/t\/([A-Za-z0-9]{6,})/);
    if (shareT) return { username: null, postId: shareT[1], kind: 'video' };

    // A lone segment on vm./vt. is also a share link. This must NOT match `/@handle` —
    // that is a profile, and treating it as a short link is how a profile link gets ordered
    // as a video (the original bug: "Could not read that video" on every likes order).
    const isShortHost = /(^|\.)(vm|vt)\.tiktok\.com$/i.test(url.hostname);
    if (isShortHost && segments.length === 1 && !segments[0].startsWith('@')) {
      return { username: null, postId: segments[0], kind: 'video' };
    }
    return null;
  }

  if (platform === Platform.Facebook) {
    // ?fbid=<id> on a /photo link
    const fbid = url.searchParams.get('fbid');
    if (fbid) return { username: null, postId: fbid, kind: 'photo' };

    // /<page or profile>/posts|videos|photos|reel/<id>
    if (
      segments[1] &&
      segments[2] &&
      ['posts', 'videos', 'photos', 'reel', 'photo'].includes(segments[1])
    ) {
      return {
        username: segments[0].toLowerCase(),
        postId: segments[2],
        kind: segments[1] === 'videos' || segments[1] === 'reel' ? 'video' : 'post',
      };
    }

    // /share/p/<token> (the form Facebook hands to the share sheet) and /share/<token>.
    // The real numeric id is only visible after following the redirect.
    if (segments[0] === 'share') {
      const token = segments[2] ?? segments[1];
      if (token) return { username: null, postId: token, kind: 'post' };
    }
    return null;
  }

  return null;
}

/**
 * Short links that need a redirect followed before the id is visible.
 * `vm.tiktok.com`, `vt.tiktok.com`, `fb.watch`, and `facebook.com/share/p/<id>`.
 */
export function needsRedirect(platform, raw) {
  const url = toUrl(raw);
  if (!url || !hostMatches(platform, url.hostname)) return true;
  if (platform === Platform.TikTok) {
    return !url.pathname.startsWith('/@');
  }
  if (platform === Platform.Facebook) {
    return (
      url.hostname.includes('fb.watch') ||
      (url.pathname.startsWith('/share/') && !url.pathname.match(/\/posts\/\d+|\/videos\/\d+/))
    );
  }
  return false;
}

/** Human label for a link that could not be parsed — used in the client's error. */
export function linkFormatHint(platform) {
  switch (platform) {
    case Platform.Instagram:
      return 'an Instagram link to a single post, e.g. instagram.com/p/abc123/';
    case Platform.Facebook:
      return 'a Facebook link to a single post, e.g. facebook.com/yourpage/posts/123';
    default:
      return 'a TikTok link to a single video, e.g. tiktok.com/@you/video/1234567890';
  }
}
