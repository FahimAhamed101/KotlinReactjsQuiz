// Platform dispatch — one entry point for "give me the profile for this handle".
//
// Why this file exists:
//
// `tiktok.js`, `instagram.js` and `facebook.js` are three different providers with three
// different hosts and three different response shapes. Every caller that needs a profile
// (login, the pre-sign-in lookup, the task checker) used to import `tiktok.js`
// directly, which meant every one of them hard-coded TikTok — and adding a second
// platform meant adding an `if (platform === ...)` branch to each.
//
// This module is the single place that knows which provider serves which platform,
// so the callers stay platform-agnostic:
//
//   const profile = await getProfileForPlatform(platform, username);
//
// The rule the callers depend on: **a stub is never returned as a profile.** The
// TikTok provider returns a deterministic stub when no API key is configured; the
// Instagram and Facebook providers return null. Both are handled here so that a
// platform without a configured provider produces an honest "not configured" error
// rather than a placeholder picture that looks like the wrong person's face.

import { Platform, normalizePlatform } from './platforms';
import { getProfileInfo as getTikTokProfile, hasLiveProvider as hasTikTokProvider } from './tiktok.js';
import { getProfileInfo as getInstagramProfile, hasLiveProvider as hasInstagramProvider } from './instagram.js';
import { getProfileInfo as getFacebookProfile, hasLiveProvider as hasFacebookProvider } from './facebook.js';

/** True when this platform has a real provider configured. */
export function hasLiveProvider(platform) {
  switch (normalizePlatform(platform)) {
    case Platform.Instagram:
      return hasInstagramProvider();
    case Platform.Facebook:
      return hasFacebookProvider();
    default:
      return hasTikTokProvider();
  }
}

/**
 * Fetch a profile for any platform.
 *
 * @param {string} platform
 * @param {string} username
 * @returns {Promise<object|null>} the provider's profile, or null when the platform
 *   has no provider, the provider failed, or the handle does not exist.
 */
export async function getProfileForPlatform(platform, username, secUid = null) {
  switch (normalizePlatform(platform)) {
    case Platform.Instagram:
      return getInstagramProfile(username);
    case Platform.Facebook:
      // Facebook's provider resolves a handle to a URL itself, so a pasted profile
      // link (`facebook.com/zuck`) works as well as a bare slug.
      return getFacebookProfile(username);
    default:
      return getTikTokProfile(username, secUid);
  }
}

/**
 * Same as [getProfileForPlatform], but the returned profile always carries the
 * platform it came from.
 *
 * The Account row stores the platform separately, so this matters for every
 * non-TikTok path: a provider's own object may not have a `platform` field, and a row
 * written without one would default to TikTok and then be served the wrong picture.
 */
export async function getProfileInfo(platform, username, secUid = null) {
  const profile = await getProfileForPlatform(platform, username, secUid);
  if (!profile) return null;
  return { ...profile, platform: normalizePlatform(platform) };
}

export { Platform, normalizePlatform };