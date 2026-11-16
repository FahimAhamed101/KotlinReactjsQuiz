// Retire demo orders that can never be completed, so they stop filling the task feed.
//
// Why this exists
// ---------------
// The Tasks screen is `GET /api/v6/orders` — the *open orders* of other users — so a
// demo order that can never be verified is served to every viewer as a task that can
// never pay. Tapping it looks exactly like a broken coin payout.
//
// Two classes of demo order are provably dead:
//
//   1. `account_unreadable`  the order's target handle does not resolve on its own
//      network. The seeded `fahim1000011` TikTok tasks are the example: that handle is
//      invalid on TikTok (`unique_id is invalid`), so the verifier can only ever answer
//      "cannot see it". The order is refused forever.
//
//   2. `test_fixture_post`   a likes order whose post is the test suite's fixture
//      (`instagram.com/p/tsxp1hhQTG`, a 2014 @instagram post). It appears only in
//      `test-multiplatform-orders.mjs` / `test-platform-posts.mjs` / `tmp-ig-case.mjs`,
//      which POST real orders at whatever server they are pointed at — so running the
//      suite against the shared cluster leaves these behind. They also carry a
//      target/post mismatch: the card says "Like a post by @fahim_prime3000" while the
//      post belongs to @instagram.
//
// Safety
// ------
// * Only `type === 'Free'` orders are ever touched — no billing, so no refund is owed.
// * Dry run by default. Nothing is written without `--apply`.
// * A run that could not reach the provider is skipped, never retired: absence of
//     evidence is not evidence of absence.
// * Cancelling uses the real lifecycle spelling (`OrderStatus.Cancelled`), sets
//   `adminCanceled` so the client does not offer "Reactivate", and promotes whatever
//   was queued behind it exactly as the live cancel path does.
//
// Usage:
//   node --import ./scripts/register-esm-hook.mjs scripts/retire-dead-demo-orders.mjs
//   node --import ./scripts/register-esm-hook.mjs scripts/retire-dead-demo-orders.mjs --apply
//   ... --limit=0     evaluate every candidate (default 40, provider-paced)

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { loadEnv } = require('./load-env.cjs');
loadEnv(resolve(here, '..', '.env'));

const apply = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : 40;

const { dbConnect } = await import('../lib/mongodb.js');
const db = (await import('../lib/db.js')).default;
const { OrderStatus, OrderCancelCode } = await import('../lib/constants.js');
const { hasLiveProvider, getProfileInfo } = await import('../lib/services/profiles.js');
const { promoteNextQueuedOrder } = await import('../lib/services/orderLifecycle.js');

/** The test suite's fixture post. Kept in one place so the reason is auditable. */
const TEST_FIXTURE_POST_IDS = ['tsxp1hhQTG'];

const OPEN_STATUSES = [OrderStatus.Pending, OrderStatus.InQueue, OrderStatus.Progress];
const PACE_MS = 1200; // RapidAPI throttles bursts, and a throttled call looks like a missing target.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await dbConnect();

const rows = await db.order.find({ where: { type: 'Free' } });
const all = Array.isArray(rows) ? rows : [rows];
const candidates = all.filter((o) => OPEN_STATUSES.includes(o.status));
console.log(`Free orders: ${all.length}   open (Pending/InQueue/Progress): ${candidates.length}`);
console.log(`mode: ${apply ? 'APPLY — will cancel' : 'DRY RUN — read only'}\n`);

const dead = [];
const skipped = [];
let evaluated = 0;

for (const o of candidates) {
  if (limit > 0 && evaluated >= limit) {
    console.log(`(limit ${limit} reached; re-run to continue)`);
    break;
  }
  const platform = String(o.platform ?? 'tiktok');
  const username = String(o.username ?? '');
  const label = `#${o.id} ${platform}/${username}${o.isLikes ? ` post=${o.postPk}` : ' (follow)'}`;

  // Never judge a platform we cannot read — a key-less environment would "prove"
  // every order dead.
  if (!hasLiveProvider(platform)) {
    skipped.push(`${label}  -> no live provider for ${platform}; not judged`);
    continue;
  }

  evaluated += 1;
  let reason = null;

  if (String(o.postPk ?? '') && TEST_FIXTURE_POST_IDS.includes(String(o.postPk))) {
    reason = `test_fixture_post (${o.postPk} is the test suite's fixture)`;
  } else {
    const profile = await getProfileInfo(platform, username, o.secUid ?? null);
    await sleep(PACE_MS);
    if (profile === null) {
      reason = 'account_unreadable (target handle does not resolve on its network)';
    }
  }

  if (reason) {
    dead.push({ order: o, label, reason });
    console.log(`DEAD  ${label}\n      ${reason}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

console.log(`\n--- summary ---`);
console.log(`evaluated: ${evaluated}   dead: ${dead.length}   skipped: ${skipped.length}`);
for (const s of skipped) console.log(`  skipped: ${s}`);

if (!dead.length) {
  console.log('\nNothing to retire.');
  process.exit(0);
}

if (!apply) {
  console.log('\nDry run. Re-run with --apply to cancel these orders.');
  process.exit(0);
}

console.log('\nCancelling...');
for (const { order, label } of dead) {
  await db.order.update({
    where: { id: order.id },
    data: {
      // The double-L spelling is what Laravel writes and OrderResource emits.
      status: OrderStatus.Cancelled,
      reason: OrderCancelCode.CanceledByAdmin,
      // Blocks the client's "Reactivate" button: these are permanently dead.
      adminCanceled: true,
      finishedAt: new Date(),
    },
  });
  // Mirror the live cancel path so a queued order behind this one is not stranded.
  try {
    await promoteNextQueuedOrder(order.userId, order.url);
  } catch (e) {
    console.log(`  ! promote after ${label} failed: ${e.message}`);
  }
  console.log(`  cancelled ${label}`);
}

console.log(`\nDone. ${dead.length} orders cancelled.`);
console.log('Run the script once more: promoting queued orders can surface new candidates.');
process.exit(0);
