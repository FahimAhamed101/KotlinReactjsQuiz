// The spin wheel.
//
// Ported from CoinsController::spin + ::getRandomCoins.
//
// The payout is a *paid* reward: the client buys `ib_spin_2_99` through Google Play and
// then redeems the receipt here. That ordering is what makes the receipt check
// load-bearing — without it this endpoint would hand out up to 10,000 coins per call.

import db from '../db';
import { err } from '../errors';
import { checkPurchase } from './googlePlay';
import { CoinHistoryType, SPIN_BILLING_PRODUCT_ID } from '../constants';

export const SPIN_MIN = 1000;
export const SPIN_MAX = 10000;

/**
 * Draw a prize.
 *
 * The distribution is deliberately bottom-heavy: Laravel cubed a uniform draw, which
 * makes the expected prize ≈ min + (max-min)/4 ≈ 3250 rather than the 5500 midpoint. A
 * flat `Math.random()` between the bounds would pay out ~70 % more on average, so the
 * exponent is part of the economy, not an implementation detail.
 */
export function randomSpinCoins() {
  const biased = Math.pow(Math.random(), 3);
  return Math.round(SPIN_MIN + (SPIN_MAX - SPIN_MIN) * biased);
}

/**
 * Verify a spin purchase and pay out.
 *
 * @returns {Promise<number>} the coins awarded
 */
export async function spinReward({ userId, purchaseToken, fetchImpl }) {
  const purchase = await checkPurchase(purchaseToken, SPIN_BILLING_PRODUCT_ID, { fetchImpl });
  if (!purchase.paymentSuccess) {
    // Same code the Laravel controller returned for an unverifiable receipt. The receipt
    // is not consumed on a refusal, so the client can retry the same token.
    throw err.unknown('The spin purchase could not be verified.');
  }

  const coins = randomSpinCoins();

  await db.transaction(async (tx) => {
    await tx.coinsHistory.create({
      data: {
        userId,
        orderId: null,
        lost: null,
        count: coins,
        username: null,
        type: CoinHistoryType.Spin,
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: { coins: { increment: coins }, lastActivityAt: new Date() },
    });
  });

  return coins;
}
