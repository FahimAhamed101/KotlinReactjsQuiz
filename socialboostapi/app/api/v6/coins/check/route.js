// POST /api/v6/coins/check
//
// Ported from CoinsControllerV2::check -> CoinsCheckService::handleCheck.
// Verifies a completed follow/like and credits coins.
//
// Response: { is_success, coins_earned, already, need_relogin, is_unavailable }

import { handle } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { readJson, requireInt, tiktokUsername, optionalString, optionalInt, optionalBool } from '@/lib/validate';
import { handleCheck } from '@/lib/services/coinsCheck';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  const user = await guard(request, body, { signature: true });

  const orderId = requireInt(body, 'order_id');
  optionalString(body, 'sec_uid', { max: 255 });
  tiktokUsername(body, 'tiktok_username', { required: false });
  tiktokUsername(body, 'tt_username', { required: false });
  optionalInt(body, 'tiktok_follower');
  optionalInt(body, 'tt_following');
  optionalBool(body, 'likes_incremented');
  optionalBool(body, 'follow_incremented');

  return handleCheck({ userId: user.id, body: { ...body, order_id: orderId } });
});
