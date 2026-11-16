// READ-ONLY: does the feed still serve an order this viewer was already paid for?
//
//   node --import ./scripts/register-esm-hook.mjs scripts/feed-check-explicit.mjs <username> <userId> <accountId>
//
// `scripts/feed-state.mjs` passes `account.userId`, which is always undefined in this
// port (`accounts` has no user_id column — see lib/models/Account.js). That makes its
// output differ from what the handset actually receives. This utility takes the ids
// explicitly so the server-side feed can be compared against the device verbatim.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');

const { dbConnect } = await import('../lib/mongodb.js');
const db = (await import('../lib/db.js')).default;
const { getFeed } = await import('../lib/services/feed.js');
await dbConnect();

const [username, userIdRaw, accountIdRaw] = process.argv.slice(2);
const userId = Number(userIdRaw);
const accountId = Number(accountIdRaw);
if (!username || Number.isNaN(userId) || Number.isNaN(accountId)) {
  console.error('usage: feed-check-explicit.mjs <username> <userId> <accountId>');
  process.exit(1);
}


const page = await getFeed({
  userId,
  accountId,
  username: username.toLowerCase(),
  platform: 'instagram',
  page: 1,
  perPage: 10,
});

console.log(
  `\nfeed for @${username} (userId=${userId} accountId=${accountId}): ` +
    `${page.items.length} items hasNext=${page.hasNext} fallback=${page.usedFallback}`,
);
for (const it of page.items) {
  console.log(
    `  order #${it.id} @${it.username} ${it.isLikes ? 'Like' : 'Follow'} ` +
      `acct=${it.accountId} owner=${it.userId}`,
  );
}

// Ledger rows for THIS viewer: if one of these order ids is still in the feed above,
// the exclusion did not fire.
const ledger = await db.coinsHistory.find({ where: { userId }, limit: 200 });
const credited = new Set(
  ledger.filter((r) => r.orderId != null).map((r) => Number(r.orderId)),
);
const stillServed = page.items.filter((it) => credited.has(Number(it.id)));
console.log(
  `\nviewer has ${credited.size} credited order(s); ` +
    `still offered by the feed: ${stillServed.length}` +
    (stillServed.length ? ` -> [${stillServed.map((s) => '#' + s.id).join(', ')}]` : ''),
);

process.exit(0);
