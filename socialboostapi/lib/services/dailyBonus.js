// Daily free coins.
//
// Next.js-native feature: the Laravel original has no daily bonus (its `Spin` route is a
// paid Google Play product, not a free claim). The layout of a claim is the same as
// `welcomeBonus.js` — ledger row + balance move in one transaction — but the guard is a
// unique index instead of a read-then-write check, because this endpoint hands out money
// on an untrusted client's say-so and a race would pay twice.

import db from '../db';
import { getInt } from '../settings';
import { CoinHistoryType } from '../constants';
import { err } from '../errors';

/** UTC YYYY-MM-DD. */
function today(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** The next UTC midnight as an epoch-millis timestamp — the countdown target. */
function nextUtcMidnight(now = Date.now()) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/**
 * Grant today's daily bonus.
 *
 * @returns {Promise<{amount:number, streak:number, nextClaimAt:number}>}
 * @throws {ApiException} DailyBonusClaimed when today is already claimed
 */
export async function claimDailyBonus(userId) {
  const amount = await getInt('dailyBonus', 100);
  const day = today();

  // Is today already claimed?
  const existing = await db.dailyClaim.findOne({ where: { userId, day } });
  if (existing) {
    throw err.dailyBonusClaimed('Come back tomorrow for your next free coins.');
  }

  // Streak = consecutive days ending yesterday. A gap resets to 1 rather than continuing
  // from wherever the last claim happened, so "7 days" really means seven in a row.
  const yesterday = today(new Date(Date.now() - 86_400_000));
  const prior = await db.dailyClaim.findOne({ where: { userId, day: yesterday } });
  const streak = prior ? (prior.streak ?? 1) + 1 : 1;

  // The insert is the guard. A duplicate insert fails with E11000 and is converted into
  // the same error the pre-check would have thrown, so two racing taps cannot both pay.
  let claim;
  try {
    claim = await db.dailyClaim.create({
      data: { userId, day, streak, amount },
    });
  } catch (e) {
    if (e?.code === 11000 || e?.name === 'MongoServerError') {
      throw err.dailyBonusClaimed('Come back tomorrow for your next free coins.');
    }
    throw e;
  }

  await db.transaction([
    db.coinsHistory.create({
      data: {
        userId,
        type: CoinHistoryType.DailyBonus,
        gain: amount,
      },
    }),
    db.user.update({
      where: { id: userId },
      data: { coins: { increment: amount }, lastActivityAt: new Date() },
    }),
  ]);

  return {
    amount,
    streak: claim.streak,
    nextClaimAt: nextUtcMidnight(),
  };
}

/**
 * What the UI needs to render the claim without calling the claim itself.
 *
 * `available` is computed rather than stored, so it is correct even if the clock rolls
 * over between two reads.
 */
export async function dailyBonusStatus(userId) {
  const amount = await getInt('dailyBonus', 100);

  const claimedToday = await db.dailyClaim.findOne({ where: { userId, day: today() } });
  if (claimedToday) {
    return {
      available: false,
      amount,
      streak: claimedToday.streak ?? 1,
      nextClaimAt: nextUtcMidnight(),
      lastClaimedAt: claimedToday.claimedAt,
    };
  }

  // Longest current streak, for the "come back tomorrow and keep it going" nudge.
  const yesterday = today(new Date(Date.now() - 86_400_000));
  const prior = await db.dailyClaim.findOne({ where: { userId, day: yesterday } });

  return {
    available: true,
    amount,
    streak: prior ? (prior.streak ?? 1) + 1 : 1,
    nextClaimAt: null,
    lastClaimedAt: prior?.claimedAt ?? null,
  };
}
