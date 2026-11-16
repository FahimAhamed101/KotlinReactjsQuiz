// READ-ONLY proof that a follow task actually paid out.
//
//   node --import ./scripts/register-esm-hook.mjs scripts/verify-follow-credit.mjs <username> <orderId>
//
// Prints the four things that must all agree for a follow to have been credited:
//   1. the viewer's coins_histories FollowTask row (the receipt),
//   2. the user's balance,
//   3. the follow_counts anchor (the "before" snapshot the checker compares against),
//   4. the order's progress.
// If (1) exists but the anchor did not move, the payout was not backed by a real
// follow; if the anchor moved without (1), something re-anchored the baseline.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');

const { dbConnect } = await import('../lib/mongodb.js');
const db = (await import('../lib/db.js')).default;
await dbConnect();

const username = (process.argv[2] || '').toLowerCase();
const orderId = Number(process.argv[3]);
if (!username || Number.isNaN(orderId)) {
  console.error('usage: verify-follow-credit.mjs <username> <orderId>');
  process.exit(1);
}

const acct = await db.account.findOne({ where: { username } });
if (!acct) {
  console.error(`no account row for @${username}`);
  process.exit(1);
}

console.log(`\n--- ledger rows for order #${orderId} ---`);
const rows = await db.coinsHistory.find({ where: { orderId }, sort: { id: 'desc' }, limit: 20 });
if (!rows.length) console.log('  (none — the action was NOT credited)');
for (const r of rows) {
  console.log(
    `  #${r.id} user=${r.userId} acct=${r.accountId} @${r.username} type=${r.type} ` +
      `gain=${r.gain} at=${r.createdAt}`,
  );
}

console.log(`\n--- viewer user ---`);
const user = acct.userId ? await db.user.findOne({ where: { id: acct.userId } }) : null;
// `accounts` has no user_id column in this port, so the ledger's userId is the
// authoritative link; fall back to the receipt row when the account row has none.
const ledgerUser = rows[0]?.userId ?? null;
const u = ledgerUser ? await db.user.findOne({ where: { id: ledgerUser } }) : user;
console.log(
  u
    ? `  #${u.id} ${u.email} coins=${u.coins}`
    : `  (could not resolve; account.userId=${acct.userId} ledger.userId=${ledgerUser})`,
);

console.log(`\n--- follow anchor ---`);
const anchors = await db.followCount.find({ where: { username } });
if (!anchors.length) console.log('  (none)');
for (const f of anchors) {
  console.log(
    `  #${f.id} platform=${f.platform} following_count=${f.followingCount} ` +
      `last_checked=${f.lastCheckedFollowing} account_id=${f.accountId}`,
  );
}

console.log(`\n--- order #${orderId} ---`);
const order = await db.order.findOne({ where: { id: orderId } });
console.log(
  order
    ? `  @${order.username} ${order.platform} status=${order.status} ` +
        `progress=${order.currentProgress}/${order.maxProgress} (actual ${order.actualMaxProgress}) ` +
        `finishedAt=${order.finishedAt}`
    : '  (missing)',
);

process.exit(0);
