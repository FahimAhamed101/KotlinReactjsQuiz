// Why did a task pay out without the action being performed?
//
//   node --import ./scripts/register-esm-hook.mjs scripts/inspect-task-anchors.mjs <username>
//
// Read-only. Prints the two baselines the checker compares against, next to the live-ish
// values stored on the account, plus the most recent credits. A follow credits only when
// `follow_counts.following_count < live following`; a like only when
// `like_counts.last_count < live like count`. So if either baseline is 0 (or stale/low),
// every tap pays out — and that is visible here as anchor=0 with a nonzero live figure.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');

const username = (process.argv[2] || '').toLowerCase();
if (!username) {
  console.error('usage: inspect-task-anchors.mjs <username>');
  process.exit(1);
}

const { dbConnect } = await import('../lib/mongodb.js');
const db = (await import('../lib/db.js')).default;
await dbConnect();

console.log(`\n=== account rows for "${username}" ===`);
const accounts = await db.account.find({ where: { username } });
if (!accounts.length) console.log('  (none)');
for (const a of accounts) {
  console.log(
    `  #${a.id} platform=${a.platform} following=${a.following} follower=${a.follower} ` +
      `secUid=${a.secUid ? String(a.secUid).slice(0, 12) + '...' : 'null'} updated=${a.updatedAt}`,
  );
}

console.log('\n=== follow_counts rows (the follow anchor) ===');
const follows = await db.followCount.find({ where: { username } });
if (!follows.length) console.log('  (none) -> first tap creates one and does NOT credit');
for (const f of follows) {
  console.log(
    `  #${f.id} platform=${f.platform} following_count=${f.followingCount} ` +
      `last_checked=${f.lastCheckedFollowing} account_id=${f.accountId} updated=${f.updatedAt}`,
  );
}

for (const a of accounts) {
  const f = (await db.followCount.find({ where: { accountId: a.id } })) || [];
  for (const row of f) {
    if (!follows.some((x) => x.id === row.id)) {
      console.log(
        `  (by account_id) #${row.id} platform=${row.platform} username=${row.username} ` +
          `following_count=${row.followingCount} account_id=${row.accountId}`,
      );
    }
  }
}

console.log('\n=== like_counts rows (the like baselines) ===');
const likes = await db.likesCount.find({ where: { ttUsername: username }, limit: 40, sort: { id: 'desc' } });
if (!likes.length) console.log('  (none) -> a like task throws "previous like count not found"');
for (const l of likes) {
  console.log(
    `  #${l.id} order=${l.orderId} platform=${l.platform} last_count=${l.lastCount} ` +
      `is_liked=${l.isLiked} account_id=${l.accountId} url=${l.url}`,
  );
  if (Number(l.lastCount) === 0) {
    console.log('      ^^ ZERO BASELINE: any live like count above 0 will verify instantly');
  }
}

console.log('\n=== recent credits for this account ===');
const acctIds = accounts.map((a) => a.id);
const hist = await db.coinsHistory.find({
  where: { OR: [{ username }, ...acctIds.map((id) => ({ accountId: id }))] },
  sort: { id: 'desc' },
  limit: 15,
});
if (!hist.length) console.log('  (none)');
for (const h of hist) {
  console.log(
    `  #${h.id} ${h.createdAt} type=${h.type} gain=${h.gain} lost=${h.lost} ` +
      `order=${h.orderId} post=${h.postPk}`,
  );
}

process.exit(0);