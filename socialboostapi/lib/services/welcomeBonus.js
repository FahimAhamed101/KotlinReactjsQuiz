// Welcome bonus + referral.
//
// Ported from App\Services\WelcomeBonusService and the referral branch of
// AuthService.
//
// The Laravel version throttles the welcome bonus with a 3-hour cache slot
// counter; once a slot exceeds `maxFullWelcomeBonusPer3Hours` a scheduled command
// lowers the setting to `reducedWelcomeBonus` for the remainder of the slot.
//
// The counter is process-local here (see the porting notes: a multi-instance
// deployment needs Redis). Crucially it FAILS OPEN, exactly like the original —
// a counter failure must never block a signup.

import db from '../db';
import { getInt } from '../settings';
import { CoinHistoryType } from '../constants';

const SLOT_MS = 3 * 60 * 60 * 1000;

let slotStart = 0;
let slotCount = 0;

function currentSlot() {
  const now = Date.now();
  const start = Math.floor(now / SLOT_MS) * SLOT_MS;
  if (start !== slotStart) {
    slotStart = start;
    slotCount = 0;
  }
  return { start, count: slotCount };
}

/**
 * Grant the welcome bonus and record it.
 * @returns {Promise<number>} coins granted
 */
export async function claimWelcomeBonus(userId) {
  let amount = await getInt('welcomeBonus', 30);

  try {
    const { count } = currentSlot();
    const cap = await getInt('maxFullWelcomeBonusPer3Hours', 500);

    if (count >= cap) {
      // Slot is saturated — hand out the reduced bonus for the rest of it.
      amount = await getInt('reducedWelcomeBonus', 50);
    }
    slotCount += 1;
  } catch {
    // Fail open: grant the full configured bonus rather than blocking signup.
  }

  await db.transaction([
    db.coinsHistory.create({
      data: { userId, type: CoinHistoryType.Bonus, gain: amount },
    }),
    db.user.update({
      where: { id: userId },
      data: { coins: { increment: amount }, lastActivityAt: new Date() },
    }),
  ]);

  return amount;
}

/**
 * Credit the referrer.
 *
 * The Laravel rule is unusual and is preserved: while the referrer has three or
 * fewer LikeTask/FollowTask rows they may only ever earn ONE referral; past that
 * the cap becomes `maxReferralsPerUser`.
 *
 * @param {string|number} referral the referral code from the signup payload. Laravel
 *   reads it as `User::find((int) $referral)` — i.e. a **numeric user id**. This port
 *   used to look it up as an email, so a client sending an id (the documented
 *   contract) silently earned the referrer nothing. The email form is still accepted
 *   as a fallback.
 */
export async function creditReferral(referral, newUserId) {
  const raw = String(referral ?? '').trim();
  const asId = Number.parseInt(raw, 10);

  const referrer =
    (Number.isFinite(asId) && asId > 0
      ? await db.user.findOne({ where: { id: asId } })
      : null) ??
    (raw.includes('@') ? await db.user.findOne({ where: { email: raw } }) : null);

  if (!referrer) return 0;

  const taskCount = await db.coinsHistory.count({
    where: {
      userId: referrer.id,
      type: { in: [CoinHistoryType.LikeTask, CoinHistoryType.FollowTask] },
    },
  });

  const maxReferrals = await getInt('maxReferralsPerUser', 5);
  const cap = taskCount <= 3 ? 1 : maxReferrals;

  const already = await db.coinsHistory.count({
    where: { userId: referrer.id, type: CoinHistoryType.Referral },
  });
  if (already >= cap) return 0;

  const amount = await getInt('referral', 250);

  await db.transaction([
    db.coinsHistory.create({
      data: {
        userId: referrer.id,
        type: CoinHistoryType.Referral,
        gain: amount,
        count: newUserId,
      },
    }),
    db.user.update({
      where: { id: referrer.id },
      data: { coins: { increment: amount } },
    }),
  ]);

  return amount;
}
