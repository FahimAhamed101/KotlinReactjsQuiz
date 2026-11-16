// READ-ONLY: does getFeed() still re-offer an order this viewer was already credited for?
//
//   node --import ./scripts/register-esm-hook.mjs scripts/verify-feed-fix.mjs <username> <userId> <accountId> [platform]
//
// The point of the check: an order that has already paid this viewer, but is still served by
// the feed, is exactly what produces the user-visible "Could not verify" toast — the user
// repeats an action the ledger has already settled, and the checker refuses to pay twice.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');

const { dbConnect } = await import('../lib/mongodb.js');
const db = (await import('../lib/db.js')).default;
const { getFeed } = await import('../lib/services/feed.js');
await dbConnect();

const [username, userIdRaw, accountIdRaw, platform = 'instagram'] = process.argv.slice(2);
const userId = Number(userIdRaw);
const accountId = Number(accountIdRaw);
if (!username || Number.isNaN(userId) || Number.isNaN(accountId)) {
  console.error('usage: verify-feed-fix.mjs <username> <userId> <accountId> [platform]');
  process.exit(1);
}

const page = await getFeed({
  userId,
  accountId,
  username: username.toLowerCase(),
  platform,
  page: 1,
  perPage: 20,
});

// Ledger rows addressed to THIS viewer. `coins_histories.username` is the viewer, which is
// why it — not accountId — is the reliable key here.
const ledger = await db.coinsHistory.find({ where: { username: username.toLowerCase() }, limit: 500 });
const credited = new Set(
  ledger.filter((r) => r.orderId != null).map((r) => Number(r.orderId)),
);

console.log(
  `\nfeed for @${username} (userId=${userId} accountId=${accountId} platform=${platform}): ` +
    `${page.items.length} items hasNext=${page.hasNext} fallback=${page.usedFallback}`,
);
let leaks = 0;
for (const it of page.items) {
  const paid = credited.has(Number(it.id));
  if (paid) leaks++;
  console.log(
    `  order #${it.id} @${it.username} acct=${it.accountId} owner=${it.userId}` +
      (paid ? '   <-- ALREADY PAID (LEAK)' : ''),
  );
}

console.log(
  `\nviewer has ${credited.size} credited order(s); re-offered by the feed: ${leaks}` +
    (leaks ? ` -> [${page.items.filter((i) => credited.has(Number(i.id))).map((s) => '#' + s.id).join(', ')}]` : ''),
);
process.exit(leaks === 0 ? 0 : 2);
