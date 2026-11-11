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
// What the callers can rely on:
//   * A platform with **no configured provider** yields `null` — Instagram and Facebook
//     return null outright, so a "not configured" platform gives an honest null rather
//     than a placeholder picture that looks like the wrong person's face.
//   * The **TikTok** provider does NOT return null when no API key is configured: it
//     returns a deterministic *stub* carrying `isStub: true`, a picsum avatar and
//     hash-derived counters, so the flow stays exercisable in dev.
//
// That second point used to be documented here as "a stub is never returned as a
// profile", which was simply false and cost real coins: the task checker trusted the
// stub's invented following/like counts as proof that a user had performed an action.
// Anything that *verifies* something must therefore check `profile.isStub` and refuse —
// see `lib/services/coinsCheck.js`. Login and display paths may use the stub as a
// placeholder; verification paths never may.

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