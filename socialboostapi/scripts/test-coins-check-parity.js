// Parity test for the coin checker against App\Services\CoinsCheckService.
//
// Run with:
//   node --import ./scripts/register-esm-hook.mjs scripts/test-coins-check-parity.js
//
// Every check below corresponds to a behaviour the Laravel original has and an
// earlier build of this port did not. They are ordered so that the money-losing
// ones come first:
//
//   [A] no follow_counts anchor  -> must NOT credit (was: paid free coins)
//   [B] anchor below live count  -> must credit exactly once
//   [C] replaying the same check -> must not pay twice
//   [D] legacy ledger rows       -> account_id IS NULL must still match
//   [E] unfollow                 -> must not credit, must re-anchor
//   [F] last unit of progress    -> order completes and the queue advances
//   [G] cancellation             -> 'Cancelled' status + human-readable reason
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

const { db } = await import('../lib/db.js');
const { handleCheck, cancelOrder } = await import('../lib/services/coinsCheck.js');
const { OrderStatus, CoinHistoryType } = await import('../lib/constants.js');

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

const TAG = 'coins-parity-test';
const EMAIL = `${TAG}@socialboost.app`;
const VIEWER = `${TAG}-viewer`;
const OWNER = `${TAG}-owner`;
const VIEWER_SEC = `MS4wLjABAAAA${TAG}viewer`;
const URL = `https://www.tiktok.com/@${OWNER}`;

// The offline provider stub derives a deterministic count from the username, so
// the same username always yields the same "live" following count.
const { getProfileInfo } = await import('../lib/services/tiktok.js');
const live = await getProfileInfo(VIEWER, VIEWER_SEC);
if (!live) {
  console.error('Cannot run: the TikTok provider returned nothing for the test viewer.');
  process.exit(1);
}
const LIVE_COUNT = live.followingCount;

async function cleanup() {
  await db.coinsHistory.deleteMany({ where: { userId: { gt: 0 }, username: VIEWER } });
  await db.followCount.deleteMany({ where: { username: VIEWER } });
  await db.order.deleteMany({ where: { username: { in: [OWNER, VIEWER] } } });
  await db.account.deleteMany({ where: { username: { in: [VIEWER, OWNER] } } });
  await db.user.deleteMany({ where: { email: EMAIL } });
}

async function coinsOf(userId) {
  const u = await db.user.findOne({ where: { id: userId } });
  return u?.coins ?? null;
}

// ---------------------------------------------------------------------------
console.log('\n[0] setup');
await cleanup();

const user = await db.user.create({
  data: { email: EMAIL, password: EMAIL, name: 'Coins Parity Test', coins: 0, status: 'Active' },
});
const uid = user.id;

await db.account.create({
  data: { username: VIEWER, secUid: VIEWER_SEC, following: LIVE_COUNT, follower: 10 },
});
await db.account.create({
  data: { username: OWNER, secUid: `${VIEWER_SEC}-owner`, following: 1, follower: 1 },
});

const order = await db.order.create({
  data: {
    userId: uid,
    productId: 1,
    image: 'x.png',
    username: OWNER,
    url: URL,
    type: 'Free',
    maxProgress: 10,
    actualMaxProgress: 10,
    isLikes: false,
    currentProgress: 0,
    clicks: 0,
    status: OrderStatus.Progress,
    startCount: LIVE_COUNT - 1,
    expectedCount: LIVE_COUNT - 1 + 10,
  },
});

ok('fixture user created', typeof uid === 'number', `id=${uid}`);
ok('no follow_counts anchor yet', (await db.followCount.count({ where: { username: VIEWER } })) === 0);

const body = { order_id: order.id, tt_username: VIEWER, sec_uid: VIEWER_SEC };

// ---------------------------------------------------------------------------
console.log('\n[A] no anchor row -> anchor, but no payout');
const a = await handleCheck({ userId: uid, body });
ok('check reported failure', a.is_success === false, JSON.stringify(a));
ok('no coins were paid', (await coinsOf(uid)) === 0, `coins=${await coinsOf(uid)}`);
ok(
  'no ledger row was written',
  (await db.coinsHistory.count({ where: { userId: uid, orderId: order.id } })) === 0,
);
ok(
  'an anchor row was created at the live count',
  (await db.followCount.findOne({ where: { username: VIEWER } }))?.followingCount === LIVE_COUNT,
  `anchor=${(await db.followCount.findOne({ where: { username: VIEWER } }))?.followingCount} live=${LIVE_COUNT}`,
);

// ---------------------------------------------------------------------------
console.log('\n[B] anchor just below the live count -> pay exactly once');
const anchor = await db.followCount.findOne({ where: { username: VIEWER } });
await db.followCount.update({ where: { id: anchor.id }, data: { followingCount: LIVE_COUNT - 1 } });

const b = await handleCheck({ userId: uid, body });
ok('check succeeded', b.is_success === true, JSON.stringify(b));
ok('paid the follow setting (5)', b.coins_earned === 5, `earned=${b.coins_earned}`);
ok('balance went up by 5', (await coinsOf(uid)) === 5, `coins=${await coinsOf(uid)}`);

const ledger = await db.coinsHistory.findOne({ where: { userId: uid, orderId: order.id } });
ok('ledger row written', !!ledger);
ok('ledger type is FollowTask', ledger?.type === CoinHistoryType.FollowTask, `type=${ledger?.type}`);
ok(
  'ledger records the VIEWER, not the order owner',
  ledger?.username === VIEWER,
  `username=${ledger?.username}`,
);
ok('ledger records the viewer account id', ledger?.accountId !== null, `accountId=${ledger?.accountId}`);

const afterB = await db.order.findOne({ where: { id: order.id } });
ok('order progress advanced', afterB.currentProgress === 1, `progress=${afterB.currentProgress}`);
ok('order still running', afterB.status === OrderStatus.Progress, `status=${afterB.status}`);

// ---------------------------------------------------------------------------
console.log('\n[C] replaying the same check must not pay twice');
const c = await handleCheck({ userId: uid, body });
ok('replay reported already', c.already === true, JSON.stringify(c));
ok('replay paid nothing', c.coins_earned === 0, `earned=${c.coins_earned}`);
ok('balance unchanged', (await coinsOf(uid)) === 5, `coins=${await coinsOf(uid)}`);
ok(
  'exactly one ledger row exists',
  (await db.coinsHistory.count({ where: { userId: uid, orderId: order.id } })) === 1,
);

// ---------------------------------------------------------------------------
console.log('\n[D] legacy ledger rows (account_id IS NULL) still count as credited');
// Rewrite the row the way the pre-account_id schema stored it.
await db.coinsHistory.update({ where: { id: ledger.id }, data: { accountId: null } });
const d = await handleCheck({ userId: uid, body });
ok('legacy row was recognised as already credited', d.already === true, JSON.stringify(d));
ok('legacy row paid nothing', (await coinsOf(uid)) === 5, `coins=${await coinsOf(uid)}`);

// Put the account id back for the remaining checks.
await db.coinsHistory.update({ where: { id: ledger.id }, data: { accountId: ledger.accountId } });

// ---------------------------------------------------------------------------
console.log('\n[E] unfollow (count went down) -> no payout, anchor re-baselined');
const high = await db.followCount.findOne({ where: { username: VIEWER } });
await db.followCount.update({ where: { id: high.id }, data: { followingCount: LIVE_COUNT + 25 } });
await db.coinsHistory.deleteMany({ where: { userId: uid, orderId: order.id } });

const e = await handleCheck({ userId: uid, body });
ok('unfollow paid nothing', e.is_success === false && e.coins_earned === 0, JSON.stringify(e));
ok('balance unchanged', (await coinsOf(uid)) === 5, `coins=${await coinsOf(uid)}`);
ok(
  'anchor was lowered back to the live count',
  (await db.followCount.findOne({ where: { username: VIEWER } }))?.followingCount === LIVE_COUNT,
  `anchor=${(await db.followCount.findOne({ where: { username: VIEWER } }))?.followingCount}`,
);

// ---------------------------------------------------------------------------
console.log('\n[F] the last unit of progress completes the order and advances the queue');
// Park the order one short of completion, with a queued twin behind it.
await db.order.update({
  where: { id: order.id },
  data: { currentProgress: 9, actualMaxProgress: 10, maxProgress: 10 },
});
const queued = await db.order.create({
  data: {
    userId: uid,
    productId: 1,
    image: 'x.png',
    username: OWNER,
    url: URL,
    type: 'Free',
    maxProgress: 10,
    actualMaxProgress: 10,
    isLikes: false,
    currentProgress: 0,
    clicks: 0,
    status: OrderStatus.InQueue,
    reason: null,
    startCount: LIVE_COUNT,
    expectedCount: LIVE_COUNT + 10,
  },
});
await db.coinsHistory.deleteMany({ where: { userId: uid, orderId: order.id } });
const anchorF = await db.followCount.findOne({ where: { username: VIEWER } });
await db.followCount.update({ where: { id: anchorF.id }, data: { followingCount: LIVE_COUNT - 1 } });

const f = await handleCheck({ userId: uid, body });
ok('final unit paid', f.is_success === true, JSON.stringify(f));

const done = await db.order.findOne({ where: { id: order.id } });
ok('order is Completed', done.status === OrderStatus.Completed, `status=${done.status}`);
ok(
  'progress snapped to actual_max_progress',
  done.currentProgress === done.actualMaxProgress,
  `progress=${done.currentProgress} target=${done.actualMaxProgress}`,
);
ok('finished_at was stamped', !!done.finishedAt, `finishedAt=${done.finishedAt}`);

const promoted = await db.order.findOne({ where: { id: queued.id } });
ok('the queued order was promoted', promoted.status === OrderStatus.Progress, `status=${promoted.status}`);
ok('the promoted order got a fresh start count', promoted.startCount !== null, `start=${promoted.startCount}`);
ok(
  'expected_count = start_count + max_progress',
  Number(promoted.expectedCount) === Number(promoted.startCount) + promoted.maxProgress,
  `${promoted.expectedCount} vs ${promoted.startCount}+${promoted.maxProgress}`,
);

// ---------------------------------------------------------------------------
console.log('\n[G] cancellation writes the canonical status and a readable reason');
ok(
  "OrderStatus.Canceled is the canonical 'Cancelled'",
  OrderStatus.Canceled === 'Cancelled' && OrderStatus.Cancelled === 'Cancelled',
  `Canceled=${OrderStatus.Canceled} Cancelled=${OrderStatus.Cancelled}`,
);

await cancelOrder(queued.id, 'Video is unavailable', 'Unavailable_Video');
const cancelled = await db.order.findOne({ where: { id: queued.id } });
ok('status is Cancelled', cancelled.status === 'Cancelled', `status=${cancelled.status}`);
ok(
  'reason holds the message, not the enum value',
  cancelled.reason === 'Video is unavailable',
  `reason=${cancelled.reason}`,
);

// An already-completed order must not be re-cancelled by a late checker call.
await cancelOrder(order.id, 'Video is unavailable', 'Unavailable_Video');
const stillDone = await db.order.findOne({ where: { id: order.id } });
ok('a completed order is not cancelled', stillDone.status === OrderStatus.Completed, `status=${stillDone.status}`);

// ---------------------------------------------------------------------------
console.log('\n[H] cleanup');
await cleanup();
ok('test user removed', (await db.user.count({ where: { email: EMAIL } })) === 0);
ok('test accounts removed', (await db.account.count({ where: { username: VIEWER } })) === 0);
ok('test orders removed', (await db.order.count({ where: { username: OWNER } })) === 0);
ok('follow_counts removed', (await db.followCount.count({ where: { username: VIEWER } })) === 0);

// ---------------------------------------------------------------------------
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.log('COINS CHECK PARITY FAILED');
  process.exit(1);
}
console.log('COINS CHECK PARITY OK');
process.exit(0);
