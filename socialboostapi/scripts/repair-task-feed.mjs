import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');
const db = (await import('../lib/db.js')).default;

const acct = await db.account.findOne({ where: { username: 'fahim1000011' } });
if (!acct) { console.log('account not found'); process.exit(1); }

const before = await db.skipCount.find({ where: { accountId: acct.id } });
const exhausted = before.filter(s => s.count >= 3).length;
console.log(`@${acct.username} accountId=${acct.id}`);
console.log(`skip rows: ${before.length} (exhausted >=3: ${exhausted})`);

// Forgive the tombstones: these rows were what kept the feed empty.
await db.skipCount.deleteMany({ where: { accountId: acct.id } });
const after = await db.skipCount.find({ where: { accountId: acct.id } });
console.log(`skip rows now: ${after.length}`);

// Prove the feed is healthy again for this viewer.
const { OrderStatus, OrderPriority } = await import('../lib/constants.js');
const { getFeed } = await import('../lib/services/feed.js');
const feed = await getFeed({ userId: acct.userId, accountId: acct.id, username: acct.username, page: 1, perPage: 10 });
console.log(`\nfeed items: ${feed.items.length} hasNext=${feed.hasNext}`);
for (const it of feed.items) console.log(`   id=${it.id} @${it.username} ${it.isLikes ? 'Like' : 'Follow'} +${it.product?.coinsPrice ?? '?'}`);
process.exit(0);
