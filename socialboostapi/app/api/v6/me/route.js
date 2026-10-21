// GET /api/v6/me
//
// Ported from AuthController::me — the user block plus the full settings map.
//
// `tiktok_info` is an addition. The app used to capture the avatar only once, at
// login, and keep it in SharedPreferences forever — so a placeholder captured during a
// stub-backed login stayed on screen permanently, and a real avatar that changed
// upstream was never picked up. Returning the account here lets the client refresh the
// picture on every launch.
//
// It reads the stored row and never calls the provider: this endpoint must not be able
// to overwrite a real profile with the offline stub (see upsertAccountFromProfile).

import { handle } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { userResource, accountResourceV2 } from '@/lib/resources';
import { allSettings } from '@/lib/settings';
import { dailyBonusStatus } from '@/lib/services/dailyBonus';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  const user = await guard(request, {}, { signature: true });
  const preferences = await allSettings({ fresh: true });

  const params = new URL(request.url).searchParams;
  const username = params.get('username')?.toLowerCase() ?? null;
  const secUid = params.get('sec_uid') ?? null;

  let account = null;
  if (secUid) account = await db.account.findOne({ where: { secUid } });
  if (!account && username) account = await db.account.findOne({ where: { username } });

  return {
    user: userResource(user),
    preferences,
    tiktok_info: accountResourceV2(account),
    // Claim state, so the client can render "Claim +100" or a countdown without asking a
    // second endpoint. Deliberately not the claim itself.
    daily_bonus: await dailyBonusStatus(user.id),
  };
});
