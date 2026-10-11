// POST /api/v6/register
//
// Ported from App\Http\Controllers\Api\v6\RegisterController -> App\Services\v6\AuthService::register
//
// Creates the user (email = id, password = id), resolves the TikTok account, and
// grants the welcome bonus + referral to non-emulator signups.
// An existing identifier yields UserAlreadyExists 409.

import { handle } from '@/lib/envelope';
import { err } from '@/lib/errors';
import { issueToken, userResource } from '@/lib/auth';
import { verifyHash } from '@/lib/signature';
import { readJson, requireString, tiktokUsername, optionalBool, optionalString } from '@/lib/validate';
import { allSettings, getInt } from '@/lib/settings';
import { accountResourceV2 } from '@/lib/resources';
import { getProfileInfo } from '@/lib/services/tiktok';
import { upsertAccountFromProfile } from '@/lib/services/coinsCheck';
import { claimWelcomeBonus, creditReferral } from '@/lib/services/welcomeBonus';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  verifyHash(request);

  const deviceName = requireString(body, 'device_name', { max: 255 });
  const id = requireString(body, 'id', { max: 255 });
  const username = tiktokUsername(body, 'username');
  const isEmulator = optionalBool(body, 'is_emulator') ?? false;
  const referral = optionalString(body, 'referral');

  if (await db.user.findOne({ where: { email: id } })) {
    throw err.userAlreadyExists('This account is already registered. Please log in instead.');
  }

  const account = await resolveAccount(username, body.sec_uid);

  const user = await db.user.create({
    data: {
      email: id,
      password: id, // no real password in this app; see the porting notes
      name: account?.nickname ?? null,
      coins: 0,
      status: 'Active',
    },
  });

  if (!isEmulator) {
    await claimWelcomeBonus(user.id);
    if (referral) await creditReferral(referral, user.id);
  }

  const auth = await issueToken(user.id, deviceName);
  const preferences = await allSettings({ fresh: true });
  const fresh = await db.user.findOne({ where: { id: user.id } });

  return {
    auth,
    user: userResource(fresh),
    preferences,
    is_login: false,
    tiktok_info: accountResourceV2(account),
  };
});

/**
 * How long a stored Account row stays usable before it is re-fetched.
 * Mirrors the `updated_at >= now()->subDays(2)` guard in
 * App\Services\v6\AuthService::resolveAccount.
 */
const ACCOUNT_FRESHNESS_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Resolve the signup's TikTok account.
 *
 * Mirrors App\Services\v6\AuthService::resolveAccount -> AuthService::saveAccountInfo.
 * A row refreshed within the last two days is reused as-is; anything staler is
 * re-fetched so the client never renders a two-day-old avatar or follower count.
 *
 * An unresolvable username is a hard UserNotFound, exactly as Laravel does. The
 * account is part of the signup response — returning null would leave the client's
 * onboarding screen without a profile to show.
 */
async function resolveAccount(username, secUid) {
  const key = String(username).toLowerCase();

  const existing = await db.account.findOne({
    where: { username: key, updatedAt: { gte: new Date(Date.now() - ACCOUNT_FRESHNESS_MS) } },
  });
  if (existing) return existing;

  const profile = await getProfileInfo(key, secUid || null);
  if (!profile) throw err.userNotFound(`username: @${key} is invalid`);
  return upsertAccountFromProfile(profile);
}
