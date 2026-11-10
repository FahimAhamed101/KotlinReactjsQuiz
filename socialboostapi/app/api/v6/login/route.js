// POST /api/v6/login
//
// Ported from App\Http\Controllers\Api\v6\LoginController -> App\Services\v6\AuthService::login
//
// V6 authenticates EXISTING users only: an unknown identifier yields
// UserNotRegistered 404 (v5 would have registered instead).
//
// The identifier is the user's email column and the password equals it — this app
// has no real password entry. Every successful login revokes all prior tokens.

import { handle } from '@/lib/envelope';
import { err } from '@/lib/errors';
import { issueToken, userResource } from '@/lib/auth';
import { verifyHash } from '@/lib/signature';
import { readJson, requireString, tiktokUsername, optionalBool, optionalString } from '@/lib/validate';
import { allSettings } from '@/lib/settings';
import { accountResourceV2 } from '@/lib/resources';
import { getProfileInfo, hasLiveProvider } from '@/lib/services/profiles';
import { upsertAccountFromProfile } from '@/lib/services/coinsCheck';
import { normalizePlatform, Platform } from '@/lib/services/platforms';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  verifyHash(request);

  const deviceName = requireString(body, 'device_name', { max: 255 });
  const id = requireString(body, 'id', { max: 255 });
  const username = tiktokUsername(body, 'username');

  // Which network this handle belongs to. Absent means TikTok — every client that
  // predates the platform field keeps working unchanged.
  const platform = normalizePlatform(optionalString(body, 'platform'));

  const user = await db.user.findOne({ where: { email: id } });
  if (!user) {
    throw err.userNotRegistered('This account is not registered. Please sign up instead.');
  }

  if (user.status !== 'Active') {
    throw err.suspended(String(user.id), [{ user_id: user.id }]);
  }

  // Resolve the account — reuse a fresh row, otherwise fetch from the platform.
  const account = await resolveAccount(platform, username, body.sec_uid);

  const auth = await issueToken(user.id, deviceName);
  const preferences = await allSettings({ fresh: true });

  return {
    auth,
    user: userResource(user),
    preferences,
    is_login: true,
    // The key stays `tiktok_info` for backwards compatibility: the Android client
    // reads this exact key, and renaming it would break every deployed build. The
    // payload inside is platform-agnostic.
    tiktok_info: accountResourceV2(account),
    platform,
  };
});

/** Reuse an Account row refreshed within 2 days; otherwise re-fetch from the platform. */
async function resolveAccount(platform, username, secUid) {
  const key = String(username).toLowerCase();

  // Matching on platform AND username: the same handle on TikTok and Instagram is
  // two different people, so a handle-only match would hand back the other
  // platform's picture.
  const existing = await db.account.findOne({ where: { platform, username: key } });

  const TWO_DAYS = 2 * 86_400_000;
  if (existing && Date.now() - new Date(existing.updatedAt).getTime() < TWO_DAYS) {
    return existing;
  }

  // No provider configured for this platform. Returning the existing row (or null)
  // is the honest answer: inventing a profile here is what produced placeholder
  // avatars for real users in the first place.
  if (!hasLiveProvider(platform)) {
    return existing ?? null;
  }

  const profile = await getProfileInfo(platform, key, secUid || existing?.secUid || null);
  if (!profile) return existing ?? null;

  return upsertAccountFromProfile(profile);
}
