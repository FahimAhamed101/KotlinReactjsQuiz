// GET /api/v6/user-info
//
// Ported from AuthController::userInfo — resolves (and refreshes) the TikTok
// account for a given sec_uid or username.

import { handle } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { err } from '@/lib/errors';
import { accountResourceV2 } from '@/lib/resources';
import { getProfileInfo } from '@/lib/services/tiktok';
import { upsertAccountFromProfile } from '@/lib/services/coinsCheck';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  await guard(request, {}, { signature: true });

  const params = new URL(request.url).searchParams;
  const secUid = params.get('sec_uid');
  const username = params.get('username') ? params.get('username').toLowerCase() : null;

  if (!secUid && !username) throw err.userNotFound('A username or sec_uid is required.');

  let account = null;
  if (secUid) account = await db.account.findOne({ where: { secUid } });
  if (!account && username) account = await db.account.findOne({ where: { username } });

  // Always refresh from the provider — this endpoint exists to return live data.
  const profile = await getProfileInfo(username ?? account?.username, secUid ?? account?.secUid);
  if (!profile) {
    if (!account) throw err.userNotFound('Account not found.');
    return { tiktok_info: accountResourceV2(account) };
  }

  account = await upsertAccountFromProfile(profile);
  return { tiktok_info: accountResourceV2(account) };
});
