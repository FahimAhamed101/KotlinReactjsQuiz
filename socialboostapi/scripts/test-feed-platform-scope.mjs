// Regression: the task feed must only serve work on the viewer's OWN network.
//
// Why this test exists
// -------------------
// A follow/like is verified by comparing the *viewer's* counter on the task's network:
// `verifyFollow` calls `profileFor(account)`, where `account` is resolved from the
// request's `platform`. So an Instagram task handed to a TikTok-only viewer can never
// verify — following on Instagram does not move the TikTok following count — and the
// task silently never pays, however many times it is completed. Before the platform
// clause a TikTok viewer was served Instagram and Facebook rows, which is exactly the
// "I followed / liked and got no coins" complaint.
//
// The negative control below matters: if the database held only TikTok tasks, a passing
// feed assertion would prove nothing about the clause. So we first assert that other
// networks really are present to be excluded.
//
// Read-only. Run with —
//   node --import ./scripts/register-esm-hook.mjs scripts/test-feed-platform-scope.mjs

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('./load-env.cjs').loadEnv('.env');

const { dbConnect } = await import('../lib/mongodb.js');
await dbConnect();
const db = (await import('../lib/db.js')).default;
const { getFeed } = await import('../lib/services/feed.js');
const { OrderStatus } = await import('../lib/constants.js');

let pass = 0;
let fail = 0;
function expect(label, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

// --- negative control: are there other networks to exclude at all? -------------
const allProgress = await db.order.find({
  where: { status: OrderStatus.Progress, deletedAt: null },
  limit: 1000,
});
const present = new Set(allProgress.map((o) => o.platform ?? 'tiktok'));
console.log(`\n=== database holds Progress orders on: ${[...present].sort().join(', ')} ===`);
expect(
  'more than one network is present (so the feed check is not vacuous)',
  present.size > 1,
  [...present].sort().join(','),
);

// --- a viewer who owns nothing, so ownership rules cannot mask the platform rule ---
const viewer = { userId: 999999, accountId: null, username: null, page: 1, perPage: 50 };

for (const platform of [...present].sort()) {
  const feed = await getFeed({ ...viewer, platform });
  const wrong = feed.items.filter((o) => (o.platform ?? 'tiktok') !== platform);

  console.log(`\n=== ${platform}: ${feed.items.length} task(s) served ===`);
  for (const o of feed.items) {
    console.log(`    #${o.id} plat=${o.platform} ${o.isLikes ? 'like  ' : 'follow'} @${o.username}`);
  }

  expect(
    `${platform}: every served task is on ${platform}`,
    wrong.length === 0,
    wrong.map((o) => `#${o.id}:${o.platform}`).join(', ') || 'none wrong',
  );
  expect(`${platform}: the feed still has something to offer`, feed.items.length > 0, String(feed.items.length));
}

// --- a viewer with no platform at all is treated as TikTok (pre-platform clients) ---
const legacy = await getFeed({ ...viewer, platform: undefined });
const legacyWrong = legacy.items.filter((o) => (o.platform ?? 'tiktok') !== 'tiktok');
console.log(`\n=== no platform supplied (legacy client): ${legacy.items.length} task(s) ===`);
expect(
  'a missing platform defaults to tiktok only',
  legacyWrong.length === 0,
  legacyWrong.map((o) => `#${o.id}:${o.platform}`).join(', ') || 'none wrong',
);

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`}  pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
