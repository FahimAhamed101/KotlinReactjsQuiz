// Read-only feed state for a handle. Does NOT log in and does NOT mutate anything.
// Run: node --import ./scripts/register-esm-hook.mjs scripts/feed-state.mjs <username>
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');
const db = (await import('../lib/db.js')).default;
const { getFeed } = await import('../lib/services/feed.js');
const { OrderStatus } = await import('../lib/constants.js');

const username = (process.argv[2] || 'fahim1000011').toLowerCase();
const acct = await db.account.findOne({ where: { username } });
if (!acct) { console.log(`no account row for @${username}`); process.exit(1); }

console.log(`@${acct.username} accountId=${acct.id} userId=${acct.userId}`);

const skips = await db.skipCount.find({ where: { accountId: acct.id } });
const exhausted = skips.filter(s => s.count >= 3).length;
console.log(`skip rows: ${skips.length} (exhausted >=3: ${exhausted})`);

const byStatus = {};
for (const st of Object.values(OrderStatus)) {
  byStatus[st] = await db.order.count({ where: { status: st, deletedAt: null } });
}
console.log('orders by status:', JSON.stringify(byStatus));

const feed = await getFeed({ userId: acct.userId, accountId: acct.id, username: acct.username, page: 1, perPage: 10 });
console.log(`feed items: ${feed.items.length} hasNext=${feed.hasNext} fallback=${feed.usedFallback}`);
for (const it of feed.items.slice(0, 12)) console.log(`   id=${it.id} @${it.username} ${it.isLikes ? 'Like' : 'Follow'}`);
process.exit(0);
