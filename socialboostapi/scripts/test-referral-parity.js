// Parity test for the referral branch of App\Services\v6\AuthService::handleReferral.
//
// Run with:
//   node --import ./scripts/register-esm-hook.mjs scripts/test-referral-parity.js
//
// The bug this pins down: the referral code is a **numeric user id**
// (`User::find((int) $referral)` in Laravel), but this port used to look it up as
// an email. A client sending an id — the documented contract — silently earned the
// referrer nothing, with no error anywhere.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

const { db } = await import('../lib/db.js');
const { creditReferral } = await import('../lib/services/welcomeBonus.js');
const { CoinHistoryType } = await import('../lib/constants.js');

let failures = 0;
let checks = 0;

function ok(label, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const TAG = 'referral-parity-test';
const EMAIL = `${TAG}@socialboost.app`;
const REFERRAL_COINS = 250; // lib/settings.js DEFAULTS.referral

async function cleanup() {
  const users = await db.user.find({ where: { email: { contains: TAG } } });
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await db.coinsHistory.deleteMany({ where: { userId: { in: ids } } });
  }
  await db.user.deleteMany({ where: { email: { contains: TAG } } });
}

async function coinsOf(userId) {
  const u = await db.user.findOne({ where: { id: userId } });
  return u?.coins ?? null;
}

// ---------------------------------------------------------------------------
console.log('\n[0] setup');
await cleanup();

const referrer = await db.user.create({
  data: { email: `${TAG}-a@socialboost.app`, password: 'x', name: 'Referrer A', coins: 0, status: 'Active' },
});
const newUser = await db.user.create({
  data: { email: `${TAG}-b@socialboost.app`, password: 'x', name: 'Signup B', coins: 0, status: 'Active' },
});
ok('referrer created', typeof referrer.id === 'number', `id=${referrer.id}`);

// ---------------------------------------------------------------------------
console.log('\n[A] a NUMERIC referral code credits the referrer');
const a = await creditReferral(String(referrer.id), newUser.id);
ok('returned the referral amount', a === REFERRAL_COINS, `got ${a}`);
ok('referrer balance went up', (await coinsOf(referrer.id)) === REFERRAL_COINS, `coins=${await coinsOf(referrer.id)}`);

const row = await db.coinsHistory.findOne({ where: { userId: referrer.id, type: CoinHistoryType.Referral } });
ok('a Referral ledger row was written', !!row);
ok('the ledger row carries the gain', row?.gain === REFERRAL_COINS, `gain=${row?.gain}`);

// ---------------------------------------------------------------------------
console.log('\n[B] the one-referral cap applies to a fresh referrer');
// The referrer has 0 LikeTask/FollowTask rows, so the cap is 1 and it is now used up.
const b = await creditReferral(String(referrer.id), newUser.id);
ok('a second referral pays nothing', b === 0, `got ${b}`);
ok('balance unchanged', (await coinsOf(referrer.id)) === REFERRAL_COINS, `coins=${await coinsOf(referrer.id)}`);

// ---------------------------------------------------------------------------
console.log('\n[C] past three tasks the cap widens to maxReferralsPerUser');
// Give the referrer 4 task rows so the cap becomes the configured max (5).
const referrer2 = await db.user.create({
  data: { email: `${TAG}-c@socialboost.app`, password: 'x', name: 'Referrer C', coins: 0, status: 'Active' },
});
for (let i = 0; i < 4; i++) {
  await db.coinsHistory.create({
    data: { userId: referrer2.id, type: i % 2 ? CoinHistoryType.LikeTask : CoinHistoryType.FollowTask, gain: 3 },
  });
}

const c1 = await creditReferral(String(referrer2.id), newUser.id);
const c2 = await creditReferral(String(referrer2.id), newUser.id);
ok('first referral paid', c1 === REFERRAL_COINS, `got ${c1}`);
ok('second referral also paid (cap is 5, not 1)', c2 === REFERRAL_COINS, `got ${c2}`);
ok('balance is 2x the referral amount', (await coinsOf(referrer2.id)) === REFERRAL_COINS * 2, `coins=${await coinsOf(referrer2.id)}`);

// ---------------------------------------------------------------------------
console.log('\n[D] an email referral still works (legacy fallback)');
const referrer3 = await db.user.create({
  data: { email: `${TAG}-d@socialboost.app`, password: 'x', name: 'Referrer D', coins: 0, status: 'Active' },
});
const d = await creditReferral(`${TAG}-d@socialboost.app`, newUser.id);
ok('email form credited', d === REFERRAL_COINS, `got ${d}`);
ok('referrer D balance went up', (await coinsOf(referrer3.id)) === REFERRAL_COINS, `coins=${await coinsOf(referrer3.id)}`);

// ---------------------------------------------------------------------------
console.log('\n[E] unknown / malformed codes are ignored, not thrown');
const e1 = await creditReferral('999999999', newUser.id);
const e2 = await creditReferral('not-a-user', newUser.id);
const e3 = await creditReferral('', newUser.id);
const e4 = await creditReferral(null, newUser.id);
ok('an unknown numeric id pays nothing', e1 === 0, `got ${e1}`);
ok('a non-numeric, non-email code pays nothing', e2 === 0, `got ${e2}`);
ok('an empty code pays nothing', e3 === 0, `got ${e3}`);
ok('a null code pays nothing', e4 === 0, `got ${e4}`);

// ---------------------------------------------------------------------------
console.log('\n[F] cleanup');
await cleanup();
ok('test users removed', (await db.user.count({ where: { email: { contains: TAG } } })) === 0);

// ---------------------------------------------------------------------------
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.log('REFERRAL PARITY FAILED');
  process.exit(1);
}
console.log('REFERRAL PARITY OK');
process.exit(0);
