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
import { getProfileInfo } from '@/lib/services/tiktok';
import { upsertAccountFromProfile } from '@/lib/services/coinsCheck';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  verifyHash(request);

  const deviceName = requireString(body, 'device_name', { max: 255 });
  const id = requireString(body, 'id', { max: 255 });
  const username = tiktokUsername(body, 'username');

  const user = await db.user.findOne({ where: { email: id } });
  if (!user) {
    throw err.userNotRegistered('This account is not registered. Please sign up instead.');
  }

  if (user.status !== 'Active') {
    throw err.suspended(String(user.id), [{ user_id: user.id }]);
  }

  // Resolve the TikTok account — reuse a fresh row, otherwise fetch.
  const account = await resolveAccount(username, body.sec_uid);

  const auth = await issueToken(user.id, deviceName);
  const preferences = await allSettings({ fresh: true });

  return {
    auth,
    user: userResource(user),
    preferences,
    is_login: true,
    tiktok_info: accountResourceV2(account),
  };
});

/** Reuse an Account row refreshed within 2 days; otherwise re-fetch from TikTok. */
async function resolveAccount(username, secUid) {
  const key = String(username).toLowerCase();
  const existing = await db.account.findOne({ where: { username: key } });

  const TWO_DAYS = 2 * 86_400_000;
  if (existing && Date.now() - new Date(existing.updatedAt).getTime() < TWO_DAYS) {
    return existing;
  }

  const profile = await getProfileInfo(key, secUid || existing?.secUid || null);
  if (!profile) return existing ?? null;

  return upsertAccountFromProfile(profile);
}
