// POST /api/v6/coins/spin
//
// Ported from CoinsController::spin. The client buys the spin product through Google Play
// and redeems the receipt here; the coins are drawn only after the receipt verifies.
//
// Response: the number of coins won, as a bare integer (Laravel returned `success($coins)`).

import { handle, success } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { readJson, requireString } from '@/lib/validate';
import { spinReward } from '@/lib/services/spin';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  const user = await guard(request, body, { signature: true });

  const purchaseToken = requireString(body, 'purchase_token', { max: 500 });

  return success(await spinReward({ userId: user.id, purchaseToken }));
});
