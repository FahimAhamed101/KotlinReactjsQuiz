// POST /api/v6/coins/check
//
// Ported from CoinsControllerV2::check -> CoinsCheckService::handleCheck.
// Verifies a completed follow/like and credits coins.
//
// Response: { is_success, coins_earned, coins_balance, already, need_relogin, is_unavailable,
//             retryable, message }
//
// `coins_balance` is the authoritative balance after the credit: the client assigns it
// rather than adding `coins_earned` locally, which drifts from the ledger after a bonus,
// an unfollow clawback or a credit from another device.
//
// `retryable` means nothing was proven either way — the provider was unreachable, or (for
// a view) it had not published the new play count yet. The client must keep the task and
// invite another Check, never tell the user they failed to perform the action.

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
