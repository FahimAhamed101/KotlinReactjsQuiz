// POST /api/v6/coins/pre-check/follow
//
// Ported from CoinsController::preCheckFollow -> CoinsCheckService::preCheckFollow.
//
// The Laravel service was stubbed out — its body was commented out and it returned
// `{tiktok_follower: 0, tt_following: 0}` unconditionally. The response shape is what the
// client depends on, so it is preserved exactly, but the numbers are now real: the client
// shows them before the user commits to a follow task, and two zeros told it nothing.
//
// When no RapidAPI key is configured, lib/services/tiktok.js returns a deterministic stub
// profile, so this stays useful in development without inventing a second code path.

import { handle, success } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { readJson, tiktokUsername } from '@/lib/validate';
import { getProfileInfo } from '@/lib/services/tiktok';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  await guard(request, body, { signature: true });

  const tiktokUser = tiktokUsername(body, 'tiktok_username');
  const ttUser = tiktokUsername(body, 'tt_username');

  const [tiktok, tt] = await Promise.all([getProfileInfo(tiktokUser), getProfileInfo(ttUser)]);

  return success({
    tiktok_follower: tiktok?.followerCount ?? 0,
    tt_following: tt?.followingCount ?? 0,
  });
});
