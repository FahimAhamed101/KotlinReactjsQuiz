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
//   [I] stub-polluted anchor -> a real follow is still credited (live defect)
//   [J] genuine unfollow     -> still pays nothing
//   [K] unchanged view count -> retryable, not "you did not watch it" (live defect)
//   [L] old snapshot         -> the plain refusal, so [K] cannot retry forever
//   [M] view counter moved   -> credited, balance reported from the server
//   [N] like                 -> plain refusal when unchanged, credited when it moves
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

// The viewer's live "following" count, supplied to the checker instead of fetched.
//
// This used to come from the offline provider stub, which derived it from a hash of the
// username. That stopped working the moment the deployment gained real TikTok keys: a
// synthetic handle 404s upstream, and the verifier refuses the stub anyway (its count is an
// invention, not evidence, so it must never verify anything). Reading the real API here
// would be wrong on its own terms too — a pure coins-logic suite must not spend the
// production subscription's monthly requests, nor start failing the day they run out.
//
// So the count is a constant and every scenario below moves the *anchor* instead, which is
// precisely the comparison the verifier makes.
const LIVE_COUNT = 325;

// Mutable so a scenario can stage a *specific* pair of numbers (the corrupt-anchor and
// unfollow cases below need exact values, not the shared default). Reset to LIVE_COUNT
// after those scenarios.
let liveCount = LIVE_COUNT;

const profileResolver = async (account) => ({
  username: account.username,
  followingCount: liveCount,
  followerCount: 10,
  secret: false,
  privateAccount: false,
});

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

async function cleanup() {
  await db.coinsHistory.deleteMany({ where: { userId: { gt: 0 }, username: VIEWER } });
  await db.followCount.deleteMany({ where: { username: VIEWER } });
  await db.likesCount.deleteMany({ where: { ttUsername: VIEWER } });
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
const a = await handleCheck({ userId: uid, body, profileResolver });
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

const b = await handleCheck({ userId: uid, body, profileResolver });
ok('check succeeded', b.is_success === true, JSON.stringify(b));
ok('paid the follow setting (5)', b.coins_earned === 5, `earned=${b.coins_earned}`);
ok('balance went up by 5', (await coinsOf(uid)) === 5, `coins=${await coinsOf(uid)}`);
// The response must carry the authoritative balance: the client displays this instead of
// adding coins_earned itself, which is how "coins added" could be shown next to a balance
// that never changed.
ok('response reports the server balance', b.coins_balance === 5, `coins_balance=${b.coins_balance}`);

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
const c = await handleCheck({ userId: uid, body, profileResolver });
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
const d = await handleCheck({ userId: uid, body, profileResolver });
ok('legacy row was recognised as already credited', d.already === true, JSON.stringify(d));
ok('legacy row paid nothing', (await coinsOf(uid)) === 5, `coins=${await coinsOf(uid)}`);

// Put the account id back for the remaining checks.
await db.coinsHistory.update({ where: { id: ledger.id }, data: { accountId: ledger.accountId } });

// ---------------------------------------------------------------------------
console.log('\n[E] unfollow (count went down) -> no payout, anchor re-baselined');
const high = await db.followCount.findOne({ where: { username: VIEWER } });
await db.followCount.update({ where: { id: high.id }, data: { followingCount: LIVE_COUNT + 25 } });
// The Account row moves with the anchor in production — both are written by the credit
// path — so model that. Leaving it at LIVE_COUNT would mean "anchor 25 above live while the
// account row agrees with live", which is the corrupt-anchor signature, not an unfollow.
await db.account.update({ where: { username: VIEWER }, data: { following: LIVE_COUNT + 25 } });
await db.coinsHistory.deleteMany({ where: { userId: uid, orderId: order.id } });

const e = await handleCheck({ userId: uid, body, profileResolver });
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

const f = await handleCheck({ userId: uid, body, profileResolver });
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
// A fresh order for the scenarios below: idempotency is per (user, order, account),
// so each one needs its own order or it would be reported as "already credited".
async function freshOrder() {
  return db.order.create({
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
      startCount: LIVE_COUNT,
      expectedCount: LIVE_COUNT + 10,
    },
  });
}

const viewerAccount = await db.account.findOne({ where: { username: VIEWER } });
const anchorRow = await db.followCount.findOne({ where: { username: VIEWER } });

// ---------------------------------------------------------------------------
console.log('\n[I] a stub-polluted anchor must not swallow a real follow');
// Exactly the live defect: the key-less deployment wrote the stub's hash count (473) for an
// account that really follows 5. A viewer then followed one person (5 -> 6) and the check
// read 473 -> 6 as a mass unfollow, re-anchored and refused to pay.
liveCount = 6;
await db.account.update({ where: { id: viewerAccount.id }, data: { following: 5 } });
await db.followCount.update({ where: { id: anchorRow.id }, data: { followingCount: 473 } });

const coinsBeforeI = await coinsOf(uid);
const orderI = await freshOrder();
const iCheck = await handleCheck({
  userId: uid,
  body: { ...body, order_id: orderI.id },
  profileResolver,
});
ok('the follow was credited anyway', iCheck.is_success === true, JSON.stringify(iCheck));
ok('paid exactly the follow reward', iCheck.coins_earned === 5, `earned=${iCheck.coins_earned}`);
ok('balance rose by 5', (await coinsOf(uid)) === coinsBeforeI + 5, `coins=${await coinsOf(uid)}`);
ok(
  'the poison was replaced by the live count',
  (await db.followCount.findOne({ where: { username: VIEWER } }))?.followingCount === 6,
  `anchor=${(await db.followCount.findOne({ where: { username: VIEWER } }))?.followingCount}`,
);

// ---------------------------------------------------------------------------
console.log('\n[J] a genuine unfollow still pays nothing');
// Anchor 100, live 5, but the account row says 10: the gap is large yet the account row
// does NOT corroborate the live count, so this is an unfollow, not a corrupt anchor.
liveCount = 5;
await db.account.update({ where: { id: viewerAccount.id }, data: { following: 10 } });
await db.followCount.update({ where: { id: anchorRow.id }, data: { followingCount: 100 } });

const coinsBeforeJ = await coinsOf(uid);
const orderJ = await freshOrder();
const jCheck = await handleCheck({
  userId: uid,
  body: { ...body, order_id: orderJ.id },
  profileResolver,
});
ok('unfollow paid nothing', jCheck.is_success === false && jCheck.coins_earned === 0, JSON.stringify(jCheck));
ok('balance unchanged', (await coinsOf(uid)) === coinsBeforeJ, `coins=${await coinsOf(uid)}`);
ok(
  'anchor was re-baselined to the live count',
  (await db.followCount.findOne({ where: { username: VIEWER } }))?.followingCount === 5,
  `anchor=${(await db.followCount.findOne({ where: { username: VIEWER } }))?.followingCount}`,
);

// ---------------------------------------------------------------------------
// A view task is proven by the post's *global* play counter, which the scraper serves from
// a cache. A read taken right after the view therefore returns the pre-view number, and
// the increment only appears a little later. Measured on the live deployment: the check at
// 21:20:58 read 1346 — exactly the snapshot — and refused, while at 21:23 the same video
// read 1349, for a video the user had in fact watched. The task was dropped and the view
// was lost, which is the "watched the video, got no coins" report.
console.log('\n[K] an unchanged view counter means "not published yet", not "not watched"');

const VIEW_PK = '7707685839148567828';
const VIEW_URL = `https://www.tiktok.com/@${OWNER}/video/${VIEW_PK}`;
const SNAPSHOT_PLAY = 1346;
let livePlay = SNAPSHOT_PLAY;

const postResolver = async () => ({
  playCount: livePlay,
  likeCount: 75,
  commentCount: 0,
  shareCount: 0,
  isStub: false,
});

async function viewOrder() {
  return db.order.create({
    data: {
      userId: uid,
      productId: 1,
      image: 'x.png',
      username: OWNER,
      url: VIEW_URL,
      postPk: VIEW_PK,
      actionType: 'view',
      type: 'Free',
      maxProgress: 10,
      actualMaxProgress: 10,
      isLikes: true,
      currentProgress: 0,
      clicks: 0,
      status: OrderStatus.Progress,
      startCount: SNAPSHOT_PLAY,
      expectedCount: SNAPSHOT_PLAY + 10,
    },
  });
}

async function viewSnapshot(orderId) {
  return db.likesCount.create({
    data: {
      orderId,
      url: VIEW_URL,
      lastCount: SNAPSHOT_PLAY,
      ttUsername: VIEWER,
      platform: 'tiktok',
      accountId: viewerAccount.id,
      metric: 'view',
      isLiked: false,
    },
  });
}

const orderK = await viewOrder();
await viewSnapshot(orderK.id);
const coinsBeforeK = await coinsOf(uid);
const kCheck = await handleCheck({
  userId: uid,
  body: { ...body, order_id: orderK.id },
  profileResolver,
  postResolver,
});
ok('reported as retryable, not as a refusal', kCheck.retryable === true, JSON.stringify(kCheck));
ok(
  'nothing was paid for an unproven view',
  kCheck.is_success === false && (await coinsOf(uid)) === coinsBeforeK,
  `coins=${await coinsOf(uid)}`,
);
ok(
  'the message blames the counter, not the viewer',
  /view count/i.test(kCheck.message ?? ''),
  `message=${kCheck.message}`,
);

// ---------------------------------------------------------------------------
console.log('\n[L] the same unchanged counter is a real refusal once the snapshot is old');
// The retryable answer must not become a permanent "try again" that never settles. After
// the grace window an unchanged counter is stale for a different reason, so the plain
// refusal — and with it "please complete the action" — is the honest answer.
const realNow = Date.now;
Date.now = () => realNow() + 31 * 60 * 1000;
const lCheck = await handleCheck({
  userId: uid,
  body: { ...body, order_id: orderK.id },
  profileResolver,
  postResolver,
});
Date.now = realNow;
ok('no longer retryable', lCheck.retryable !== true, JSON.stringify(lCheck));
ok('still paid nothing', lCheck.is_success === false && (await coinsOf(uid)) === coinsBeforeK);

// ---------------------------------------------------------------------------
console.log('\n[M] a view whose counter moved is credited, and reports the server balance');
const orderM = await viewOrder();
await viewSnapshot(orderM.id);
livePlay = SNAPSHOT_PLAY + 3;
const mCheck = await handleCheck({
  userId: uid,
  body: { ...body, order_id: orderM.id },
  profileResolver,
  postResolver,
});
ok('the view was verified', mCheck.is_success === true, JSON.stringify(mCheck));
ok('paid exactly the view reward', mCheck.coins_earned === 1, `earned=${mCheck.coins_earned}`);
ok(
  'the baseline advanced to the live counter',
  (await db.likesCount.findOne({ where: { orderId: orderM.id } }))?.lastCount === livePlay,
  `lastCount=${(await db.likesCount.findOne({ where: { orderId: orderM.id } }))?.lastCount}`,
);
ok(
  'response reports the server balance',
  mCheck.coins_balance === (await coinsOf(uid)),
  `coins_balance=${mCheck.coins_balance} db=${await coinsOf(uid)}`,
);

// ---------------------------------------------------------------------------
console.log('\n[N] a like is unchanged-or-credited, and never gets the view grace');
// The view grace above must stay scoped to views. A like's counter is moved only by that
// viewer's own click, so an unchanged value really does mean "not liked" — answering
// "try again" there would teach users to keep tapping a task they never performed. This
// scenario also guards the shared snapshot lookup: likes are by far the most common task,
// and the `metricFor` mix-up would have broken them too the moment the like branch lost its
// 'like'/null tolerance.
const orderN = await viewOrder();
// The action lives on the row, and the checker re-reads it from the database.
await db.order.update({ where: { id: orderN.id }, data: { actionType: 'like' } });
await db.likesCount.create({
  data: {
    orderId: orderN.id,
    url: VIEW_URL,
    lastCount: 75,
    ttUsername: VIEWER,
    platform: 'tiktok',
    accountId: viewerAccount.id,
    metric: 'like',
    isLiked: false,
  },
});

let likeCount = 75;
const likeResolver = async () => ({
  playCount: SNAPSHOT_PLAY,
  likeCount,
  commentCount: 0,
  shareCount: 0,
  isStub: false,
});

const coinsBeforeN = await coinsOf(uid);
const nRefuse = await handleCheck({
  userId: uid,
  body: { ...body, order_id: orderN.id },
  profileResolver,
  postResolver: likeResolver,
});
ok(
  'an unchanged like is a plain refusal, not retryable',
  nRefuse.retryable !== true && nRefuse.is_success === false,
  JSON.stringify(nRefuse),
);
ok('and it paid nothing', (await coinsOf(uid)) === coinsBeforeN, `coins=${await coinsOf(uid)}`);

likeCount = 76;
const nCredit = await handleCheck({
  userId: uid,
  body: { ...body, order_id: orderN.id },
  profileResolver,
  postResolver: likeResolver,
});
ok('a new like is credited', nCredit.is_success === true, JSON.stringify(nCredit));
ok('paid exactly the like reward', nCredit.coins_earned === 3, `earned=${nCredit.coins_earned}`);

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
