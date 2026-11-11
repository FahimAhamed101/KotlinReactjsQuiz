// Regression test: the offline stub must NEVER pay out.
//
//   node --import ./scripts/register-esm-hook.mjs scripts/test-stub-no-credit.mjs
//
// The bug this locks down. On a deployment with no scraping key configured the TikTok
// provider answers with a deterministic *stub* whose counters are invented from a hash of
// the username. The coin checker treated that invention as a live reading, so a task could
// be "verified" — and coins paid — with nothing performed on TikTok or Instagram at all.
//
// It was not theoretical: the stub reported `following = 473` for a handle whose real
// following count is 5. The `follow_counts` anchor holds whichever of the two wrote last
// (the deployment writes the stub's 473, a keyed environment writes the real 5), and the
// checker pays out whenever the live count exceeds the anchor. So a check served by the
// stub against a real anchor looked like a jump of hundreds of follows and credited
// instantly. The same applied to likes, against a hash of the post URL.
//
// The fix: a stub is never evidence. `verifyFollow` / `verifyLike` refuse `isStub`
// profiles, and the feed's anchor refresh will not seed a baseline from one.
//
// How this test forces the situation: `tiktok.js` snapshots RAPID_API_KEY at module load,
// so clearing it *before* the first import of the provider chain pins the process offline.
// Each baseline is then seeded BELOW the stub's number — exactly the arrangement that used
// to trigger a payout. The preconditions below assert the stub really is a stub and really
// is above the seeded baseline, so the test cannot pass vacuously.

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

// Pin the process to the offline provider. MUST come before the provider is imported:
// tiktok.js reads the key into a module-level const at load time.
process.env.RAPID_API_KEY = '';

const { db } = await import('../lib/db.js');
const { handleCheck } = await import('../lib/services/coinsCheck.js');
const { getProfileInfo } = await import('../lib/services/tiktok.js');
const { getPostInfo } = await import('../lib/services/posts.js');
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

const TAG = 'stub-nocredit-test';
const EMAIL = `${TAG}@socialboost.app`;
const VIEWER = `${TAG}-viewer`;
const OWNER = `${TAG}-owner`;
const VIEWER_SEC = `MS4wLjABAAAA${TAG}viewer`;
const FOLLOW_URL = `https://www.tiktok.com/@${OWNER}`;
const LIKE_URL = `https://www.tiktok.com/@${OWNER}/video/730000000000000009`;

async function cleanup() {
  await db.coinsHistory.deleteMany({ where: { username: VIEWER } });
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
console.log('\n[0] setup + preconditions (the test must not be vacuous)');

if (process.env.RAPID_API_KEY !== '') {
  console.error(`Cannot run: expected the provider to be offline, RAPID_API_KEY=${JSON.stringify(process.env.RAPID_API_KEY)}`);
  process.exit(1);
}

const stub = await getProfileInfo('tiktok', VIEWER, VIEWER_SEC);
ok('the provider really is the offline stub', stub?.isStub === true, `isStub=${stub?.isStub}`);
ok('the stub invents a following count', Number(stub?.followingCount) > 1, `following=${stub?.followingCount}`);

const stubPost = await getPostInfo('tiktok', LIKE_URL);
ok('the post provider really is the offline stub', stubPost?.isStub === true, `isStub=${stubPost?.isStub}`);
ok('the stub invents a like count', Number(stubPost?.likeCount) > 1, `likeCount=${stubPost?.likeCount}`);

await cleanup();

const user = await db.user.create({
  data: { email: EMAIL, password: EMAIL, name: 'Stub No-Credit Test', coins: 0, status: 'Active' },
});
const uid = user.id;

const viewer = await db.account.create({
  data: { username: VIEWER, secUid: VIEWER_SEC, following: stub.followingCount, follower: 10 },
});
await db.account.create({
  data: { username: OWNER, secUid: `${VIEWER_SEC}-owner`, following: 1, follower: 1 },
});

const body = { order_id: 0, tt_username: VIEWER, sec_uid: VIEWER_SEC };

// ---------------------------------------------------------------------------
console.log('\n[1] FOLLOW: anchor below the stub count -> must NOT credit');

// The anchor sits at 1 while the stub claims a count in the hundreds. Before the fix this
// was a straight payout: `1 < 473`, so `verifyFollow` updated the anchor and returned
// `credited: true`, and 5 coins landed on a task nobody performed.
const followOrder = await db.order.create({
  data: {
    userId: uid,
    productId: 1,
    image: 'x.png',
    username: OWNER,
    url: FOLLOW_URL,
    type: 'Free',
    maxProgress: 10,
    actualMaxProgress: 10,
    isLikes: false,
    currentProgress: 0,
    clicks: 0,
    status: OrderStatus.Progress,
    startCount: 0,
    expectedCount: 10,
  },
});

await db.followCount.create({
  data: {
    platform: 'tiktok',
    username: VIEWER,
    accountId: viewer.id,
    followingCount: 1,
    lastCheckedFollowing: 1,
  },
});

const f = await handleCheck({ userId: uid, body: { ...body, order_id: followOrder.id } });
ok('follow check reported failure', f.is_success === false, JSON.stringify(f));
ok('follow check credited 0 coins', f.coins_earned === 0, `earned=${f.coins_earned}`);
ok('balance unchanged (0)', (await coinsOf(uid)) === 0, `coins=${await coinsOf(uid)}`);
ok(
  'no ledger row was written',
  (await db.coinsHistory.count({ where: { userId: uid, orderId: followOrder.id } })) === 0,
);
ok(
  'the anchor was left alone (not re-based onto the stub count)',
  (await db.followCount.findOne({ where: { username: VIEWER } }))?.followingCount === 1,
  `anchor=${(await db.followCount.findOne({ where: { username: VIEWER } }))?.followingCount}`,
);
ok(
  'order progress did not advance',
  (await db.order.findOne({ where: { id: followOrder.id } }))?.currentProgress === 0,
);

// ---------------------------------------------------------------------------
console.log('\n[2] LIKE: last_count below the stub count -> must NOT credit');

const likeOrder = await db.order.create({
  data: {
    userId: uid,
    productId: 1,
    image: 'x.png',
    username: OWNER,
    url: LIKE_URL,
    postPk: '730000000000000009',
    platform: 'tiktok',
    type: 'Free',
    maxProgress: 10,
    actualMaxProgress: 10,
    isLikes: true,
    currentProgress: 0,
    clicks: 0,
    status: OrderStatus.Progress,
    startCount: 0,
    expectedCount: 10,
  },
});

await db.likesCount.create({
  data: {
    orderId: likeOrder.id,
    url: LIKE_URL,
    lastCount: 1,
    ttUsername: VIEWER,
    platform: 'tiktok',
    isLiked: false,
    accountId: viewer.id,
  },
});

const l = await handleCheck({ userId: uid, body: { ...body, order_id: likeOrder.id } });
ok('like check reported failure', l.is_success === false, JSON.stringify(l));
ok('like check credited 0 coins', l.coins_earned === 0, `earned=${l.coins_earned}`);
ok('balance still 0', (await coinsOf(uid)) === 0, `coins=${await coinsOf(uid)}`);
ok(
  'no like ledger row was written',
  (await db.coinsHistory.count({ where: { userId: uid, orderId: likeOrder.id } })) === 0,
);
ok(
  'order was not cancelled as "video unavailable"',
  (await db.order.findOne({ where: { id: likeOrder.id } }))?.status === OrderStatus.Progress,
  `status=${(await db.order.findOne({ where: { id: likeOrder.id } }))?.status}`,
);

// ---------------------------------------------------------------------------
console.log('\n[3] negative control: the OLD comparison really would have paid out');
//
// Without this, a reader cannot tell whether the check above refused because of the new
// stub guard or merely because the arithmetic never worked out. So restate the pre-fix
// conditions and assert they were satisfied — i.e. this really is the falsifying case.
const anchorAfter = (await db.followCount.findOne({ where: { username: VIEWER } }))?.followingCount;
ok(
  'follow: the old rule `anchor < live` was satisfied, so only the stub guard refuses',
  Number(anchorAfter) < Number(stub.followingCount),
  `anchor=${anchorAfter} stubLive=${stub.followingCount}`,
);
ok(
  'like: the old rule `lastCount < live` was satisfied, so only the stub guard refuses',
  1 < Number(stubPost.likeCount),
  `lastCount=1 stubLive=${stubPost.likeCount}`,
);
ok(
  'the stub count is wildly above the real count (the 473-vs-5 shape of the bug)',
  Number(stub.followingCount) > 100,
  `stubLive=${stub.followingCount}`,
);

// ---------------------------------------------------------------------------
console.log(`\n${checks - failures}/${checks} passed`);
await cleanup();
if (failures) {
  console.log(`RESULT: FAIL (${failures} failing)`);
  process.exit(1);
}
console.log('RESULT: PASS — the offline stub can no longer credit coins');
process.exit(0);
