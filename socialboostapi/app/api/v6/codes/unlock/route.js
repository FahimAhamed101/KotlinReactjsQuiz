// POST /api/v6/codes/unlock
//
// Spend coins to unlock a source code. This is the payoff for the follow/like
// grind: without it, coins can only buy TikTok boost packages, which need an SMM
// panel that is not part of this port — so coins would buy nothing real.
//
// Idempotent by construction: `code_unlocks` has a unique (user_id, code_id), so
// a repeat call finds the existing row and charges nothing. The check is made
// twice — once before the transaction for a fast path, once inside it so two
// concurrent requests cannot both charge.

import { handle } from '@/lib/envelope';
import { err } from '@/lib/errors';
import { guard } from '@/lib/guard';
import { readJson, requireString } from '@/lib/validate';
import { CoinHistoryType } from '@/lib/constants';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  const user = await guard(request, body, { signature: true });

  const codeId = requireString(body, 'code_id', { max: 64 });

  const code = await db.code.findOne({ where: { slug: codeId } });
  if (!code || !code.isActive) {
    throw err.productNotFound('That code is not available.');
  }

  // Fast path: already owned. Report it rather than charging again.
  const owned = await db.codeUnlock.findOne({
    where: { userId_codeId: { userId: user.id, codeId: code.id } },
  });
  if (owned) {
    return {
      already: true,
      code_id: code.slug,
      title: code.title,
      coins_spent: owned.coinsSpent,
      coins: user.coins,
    };
  }

  if (user.coins < code.coinsPrice) {
    throw err.coinsNotEnough('Not enough coins.');
  }

  const result = await db.transaction(async (tx) => {
    // Re-check inside the transaction: the balance and the unique constraint are
    // both only trustworthy here.
    const again = await tx.codeUnlock.findOne({
      where: { userId_codeId: { userId: user.id, codeId: code.id } },
    });
    if (again) {
      const current = await tx.user.findOne({ where: { id: user.id } });
      return { already: true, coinsSpent: again.coinsSpent, coins: current.coins };
    }

    const fresh = await tx.user.findOne({ where: { id: user.id } });
    if (fresh.coins < code.coinsPrice) {
      throw err.coinsNotEnough('Not enough coins.');
    }

    await tx.codeUnlock.create({
      data: { userId: user.id, codeId: code.id, coinsSpent: code.coinsPrice },
    });

    const updated = await tx.user.update({
      where: { id: user.id },
      data: { coins: { decrement: code.coinsPrice }, lastActivityAt: new Date() },
    });

    // Ledger entry, so the spend shows up in /v6/me/history instead of the coins
    // silently disappearing from the user's balance.
    await tx.coinsHistory.create({
      data: {
        userId: user.id,
        type: CoinHistoryType.CodeUnlock,
        lost: code.coinsPrice,
        count: 1,
      },
    });

    return { already: false, coinsSpent: code.coinsPrice, coins: updated.coins };
  });

  return {
    already: result.already,
    code_id: code.slug,
    title: code.title,
    coins_spent: result.coinsSpent,
    coins: result.coins,
  };
});
