// POST /api/v6/coins/daily
//
// Grant today's free coins. One claim per user per day.
//
// Next.js-native: there is no Laravel counterpart (the original's `Spin` is a paid Play
// product). Idempotency is the database's unique (userId, day) index — see
// lib/models/DailyClaim.js — because a read-then-write guard races when the client
// double-taps.

import { handle } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { dailyBonusStatus, claimDailyBonus } from '@/lib/services/dailyBonus';
import { userResource } from '@/lib/resources';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  const user = await guard(request, {}, { signature: true });
  const bonus = await dailyBonusStatus(user.id);
  return { user: userResource(user), daily_bonus: bonus };
});

export const POST = handle(async (request) => {
  const user = await guard(request, {}, { signature: true });

  const granted = await claimDailyBonus(user.id);

  // Re-read the balance rather than reporting a locally incremented number: rendering what
  // we *think* happened is how "charged but it says it wasn't" bugs start.
  const fresh = await db.user.findOne({ where: { id: user.id } });
  const status = await dailyBonusStatus(user.id);

  return {
    user: userResource(fresh ?? user),
    daily_bonus: {
      ...status,
      granted: granted.amount,
      streak: granted.streak,
    },
  };
});
