// READ-ONLY: answer one question — who is the viewer, and what can they actually do?
//
//   node --import ./scripts/register-esm-hook.mjs scripts/who-is-viewer.mjs
//
// Prints, for each handle of interest: the account row, its owning user, the follow
// anchor, and the Progress orders that task feed would serve.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');

const { dbConnect } = await import('../lib/mongodb.js');
const db = (await import('../lib/db.js')).default;
await dbConnect();

const HANDLES = ['fahim_prime3000', 'fahimahmed1000012', 'pr3r1th'];

for (const handle of HANDLES) {
  console.log(`\n========== @${handle} ==========`);
  const accts = await db.account.find({ where: { username: handle } });
  if (!accts.length) console.log('  (no account row)');
  for (const a of accts) {
    const owner = a.userId ? await db.user.findOne({ where: { id: a.userId } }) : null;
    console.log(
      `  account #${a.id} platform=${a.platform} userId=${a.userId} ` +
        `following=${a.following} follower=${a.follower} secUid=${a.secUid ? String(a.secUid).slice(0, 16) + '..' : 'null'}\n` +
        `     owner=${owner ? `#${owner.id} ${owner.email} coins=${owner.coins}` : '(none)'}`,
    );
    const anchors = await db.followCount.find({ where: { username: handle } });
    for (const f of anchors) {
      console.log(
        `     anchor #${f.id} platform=${f.platform} following_count=${f.followingCount} ` +
          `last_checked=${f.lastCheckedFollowing} account_id=${f.accountId}`,
      );
    }
    if (!anchors.length) console.log('     anchor: (none)');
  }
}

console.log('\n========== Progress orders the feed can serve ==========');
const { OrderStatus, normalizeX } = await import('../lib/constants.js').catch(() => ({}));
const orders = await db.order.find({ limit: 1000 });
const live = orders.filter((o) => o.status === 'Progress');
for (const o of live) {
  console.log(
    `  order #${o.id} owner_user=${o.userId} acct=${o.accountId} @${o.username} ` +
      `${o.platform} action=${o.actionType ?? (o.isLikes ? 'like' : 'follow')} ` +
      `${o.currentProgress}/${o.maxProgress} url=${o.url}`,
  );
}

process.exit(0);
