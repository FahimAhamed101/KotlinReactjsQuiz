// POST /api/v6/coins/purchase
//
// Ported from CoinsController::purchase. Redeems a Google Play receipt for a coin pack
// and credits the coins.
//
// Two deliberate changes from the Laravel original:
//
//   * `Product::find($id)` was not null-checked, so an unknown product id produced a
//     "call to a member function on null" 500 rather than a client error. It returns
//     ProductNotFound now.
//   * a `payments` row is written inside the same transaction. The unique index on
//     purchaseToken is a second, database-level guard against replaying a receipt, behind
//     the consume call that already makes a replay fail at Google.
//
// Response: the refreshed user block (the original returned the raw model, while
// AuthController::me returns UserResource — this uses the resource so the client parses
// one user shape everywhere).

import { handle, success } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { readJson, requireInt, requireString } from '@/lib/validate';
import { err } from '@/lib/errors';
import db from '@/lib/db';
import { userResource } from '@/lib/resources';
import { CoinHistoryType } from '@/lib/constants';
import { checkPurchase } from '@/lib/services/googlePlay';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  const user = await guard(request, body, { signature: true });

  const productId = requireInt(body, 'product_id');
  const purchaseToken = requireString(body, 'purchase_token', { max: 500 });

  const product = await db.product.findOne({ where: { id: productId } });
  if (!product) throw err.productNotFound('Unknown product.');
  if (!product.billingProductId) {
    // A coin pack without a Play product id cannot be paid for; a free (coins-priced)
    // product belongs in POST /v6/orders, not here.
    throw err.productNotFound('That product is not purchasable with money.');
  }

  const purchase = await checkPurchase(purchaseToken, product.billingProductId);
  if (!purchase.paymentSuccess) {
    // Same code the original returned when verification failed. The receipt is left
    // unconsumed, so the client can retry with the same token.
    throw err.unknown('The purchase could not be verified.');
  }

  const coins = product.actionCount;

  await db.transaction(async (tx) => {
    await tx.payment.create({
      data: {
        orderId: null,
        purchaseToken,
        googleOrderId: purchase.orderId ?? null,
        billingProductId: product.billingProductId,
        status: 'consumed',
      },
    });

    await tx.coinsHistory.create({
      data: {
        userId: user.id,
        orderId: null,
        lost: null,
        count: coins,
        username: null,
        type: CoinHistoryType.CoinsOrder,
      },
    });

    await tx.user.update({
      where: { id: user.id },
      data: { coins: { increment: coins }, lastActivityAt: new Date() },
    });
  });

  const fresh = await db.user.findOne({ where: { id: user.id } });
  return success(userResource(fresh));
});
