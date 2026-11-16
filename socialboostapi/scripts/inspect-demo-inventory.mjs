// READ-ONLY inventory of users / accounts / orders / anchors for the demo.
//
//   node --import ./scripts/register-esm-hook.mjs scripts/inspect-demo-inventory.mjs
//
// Prints what is actually in Atlas so a decision about "who is the viewer" can be
// made from data instead of assumptions. Touches nothing.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');

const { dbConnect } = await import('../lib/mongodb.js');
const db = (await import('../lib/db.js')).default;
await dbConnect();

const users = await db.user.find({ limit: 5000 });
console.log(`\n=== users (${users.length}) ===`);
for (const u of users) {
  const accts = await db.account.find({ where: { userId: u.id } });
  console.log(
    `  #${u.id} ${String(u.email).padEnd(28)} coins=${String(u.coins).padEnd(6)} ` +
      `accts=[${accts.map((a) => `${a.platform}/${a.username}`).join(', ')}]`,
  );
}

console.log('\n=== accounts ===');
const accounts = await db.account.find({ limit: 5000 });
for (const a of accounts) {
  console.log(
    `  #${a.id} userId=${a.userId} ${String(a.platform).padEnd(10)} @${String(a.username).padEnd(24)} ` +
      `following=${a.following} follower=${a.follower}`,
  );
}

console.log('\n=== follow_counts anchors ===');
const anchors = await db.followCount.find({ limit: 1000 });
for (const f of anchors) {
  console.log(
    `  #${f.id} ${String(f.platform).padEnd(10)} @${String(f.username).padEnd(24)} ` +
      `following_count=${f.followingCount} last_checked=${f.lastCheckedFollowing} account_id=${f.accountId}`,
  );
}

const { OrderStatus } = await import('../lib/constants.js');
const orders = await db.order.find({ limit: 1000 });
const live = orders.filter((o) => o.status === OrderStatus.Progress);
console.log(`\n=== orders: ${orders.length} total, ${live.length} in Progress ===`);
for (const o of live) {
  console.log(
    `  #${o.id} user=${o.userId} acct=${o.accountId} @${String(o.username).padEnd(20)} ` +
      `${String(o.platform).padEnd(10)} action=${String(o.actionType ?? (o.isLikes ? 'like' : 'follow')).padEnd(8)} ` +
      `${o.currentProgress}/${o.maxProgress} ${o.url}`,
  );
}

process.exit(0);
