// GET /api/v6/user-info
//
// Ported from AuthController::userInfo — resolves (and refreshes) the account for a
// given sec_uid or username, on the network the caller names.

import { handle } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { err } from '@/lib/errors';
import { accountResourceV2 } from '@/lib/resources';
import { getProfileInfo } from '@/lib/services/profiles';
import { normalizePlatform } from '@/lib/services/platforms';
import { upsertAccountFromProfile } from '@/lib/services/coinsCheck';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  await guard(request, {}, { signature: true });

  const params = new URL(request.url).searchParams;
  const secUid = params.get('sec_uid');
  const username = params.get('username') ? params.get('username').toLowerCase() : null;
  // Absent means TikTok, so an older client that never sent the field is unaffected.
  const platform = normalizePlatform(params.get('platform'));

  if (!secUid && !username) throw err.userNotFound('A username or sec_uid is required.');

  // Scoped by platform: the same handle is a different person on each network, and a
  // handle-only lookup would return the wrong row (and then refresh it from the wrong
  // provider, overwriting a real profile with a namesake's).
  let account = null;
  if (secUid) account = await db.account.findOne({ where: { secUid, platform } });
  if (!account && username) account = await db.account.findOne({ where: { username, platform } });

  // Always refresh from the provider — this endpoint exists to return live data.
  const profile = await getProfileInfo(
    platform,
    username ?? account?.username,
    secUid ?? account?.secUid,
  );
  if (!profile) {
    if (!account) throw err.userNotFound('Account not found.');
    return { tiktok_info: accountResourceV2(account) };
  }

  account = await upsertAccountFromProfile(profile);
  return { tiktok_info: accountResourceV2(account) };
});
