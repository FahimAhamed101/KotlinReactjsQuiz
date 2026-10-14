// DEV / DEMO ONLY — rewind the demo task feed so the Home tab is never empty.
//
// A real deployment never needs this: the feed is filled by other users' genuine
// orders. A single tester, however, burns through the seeded set quickly — each task
// disappears after 3 skips and permanently once credited — and then the Tasks tab
// reads "No tasks available" with nothing wrong.
//
// This rewinds ONLY the demo orders (owned by `owner*@ttboost.app`):
//   * resets them to Progress with progress 0,
//   * clears the skip counters hiding them,
//   * removes the matching coins_histories rows AND subtracts the coins they paid,
//     so the ledger and the balance stay consistent instead of silently drifting.
//
// It refuses to run unless the owner accounts all look like demo data, so it cannot
// accidentally rewind a real customer's paid order.
//
// Run:
//   node --import ./scripts/register-esm-hook.mjs scripts/replenish-demo-tasks.mjs --confirm
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

const confirmed = process.argv.includes('--confirm');

const { dbConnect } = await import('../lib/mongodb.js');
const db = (await import('../lib/db.js')).default;
const { OrderStatus } = await import('../lib/constants.js');

const conn = await dbConnect();

// Only orders owned by the seed's throwaway owners are eligible.
//
// The filter is done in JS rather than with a `like` query: lib/db.js implements only
// the Prisma operators the app actually uses (in / not / lt / gte …), and inventing an
// unsupported one here would fail silently at the worst moment.
const allUsers = await db.user.find({ limit: 5000 });
const owners = allUsers.filter((u) => /^owner\d+@ttboost\.app$/.test(u.email || ''));
const ownerIds = owners.map((u) => u.id);

if (ownerIds.length === 0) {
  console.log('no demo owner accounts found — nothing to do.');
  await conn.close();
  process.exit(0);
}

const orders = await db.order.find({ where: { userId: { in: ownerIds } }, limit: 500 });
console.log(`demo owner accounts : ${ownerIds.length}`);
console.log(`demo orders         : ${orders.length}`);

const skipRows = await db.skipCount.find({
  where: { orderId: { in: orders.map((o) => o.id) } },
  limit: 1000,
});
const ledgerRows = await db.coinsHistory.find({
  where: { orderId: { in: orders.map((o) => o.id) }, type: { in: ['FollowTask', 'LikeTask'] } },
  limit: 2000,
});
console.log(`skip counters       : ${skipRows.length}`);
console.log(`task payouts to undo: ${ledgerRows.length}`);

if (!confirmed) {
  console.log('\nDRY RUN — nothing changed. Re-run with --confirm to apply.');
  await conn.close();
  process.exit(0);
}

// Undo each payout: subtract the coins it granted, then delete the receipt.
const perUser = new Map();
for (const row of ledgerRows) {
  perUser.set(row.userId, (perUser.get(row.userId) ?? 0) + (row.gain ?? 0));
}
for (const [userId, total] of perUser) {
  if (total > 0) {
    await db.user.update({ where: { id: userId }, data: { coins: { decrement: total } } });
  }
}
if (ledgerRows.length) {
  await db.coinsHistory.deleteMany({ where: { id: { in: ledgerRows.map((r) => r.id) } } });
}

if (skipRows.length) {
  await db.skipCount.deleteMany({ where: { id: { in: skipRows.map((r) => r.id) } } });
}

for (const order of orders) {
  await db.order.update({
    where: { id: order.id },
    data: { status: OrderStatus.Progress, currentProgress: 0, finishedAt: null },
  });
}

console.log(`\nrewound ${orders.length} demo orders to Progress.`);
console.log(`cleared ${skipRows.length} skip counters, undid ${ledgerRows.length} payouts.`);

const live = await db.order.find({
  where: { userId: { in: ownerIds }, status: OrderStatus.Progress },
  limit: 500,
});
console.log(`available demo tasks now: ${live.length}`);

await conn.close();
process.exit(0);
