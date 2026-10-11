// Read the seeded data back out of MongoDB and print it in a human-checkable shape.
//
// Run with:
//   node --import ./scripts/register-esm-hook.mjs scripts/seed-verify.mjs
//
// This exists because "the seeder exited 0" is not evidence that the right rows are
// present. It prints the values the client contract actually depends on — numeric ids,
// coinsPrice vs billingProductId, the code catalogue — so a wrong seed is visible
// rather than inferred.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

const { dbConnect } = await import('../lib/mongodb.js');
const { User, Product, Code, Order, Account, Setting, CoinsHistory } = await import('../lib/models');

await dbConnect();

const demo = await User.findOne({ email: 'demo@ttboost.app' }).lean();
if (!demo) {
  console.log('!! demo user missing — run scripts/seed.mjs first');
  process.exit(1);
}

console.log('DEMO USER  :', JSON.stringify({ id: demo.id, email: demo.email, coins: demo.coins, status: demo.status }));
// `select: false` on the password fields must hold even for a lean() read; if it ever
// stops holding, hashes start leaking into API responses.
console.log('  password hidden by select:false?', 'password' in demo ? 'NO (BAD)' : 'yes');
console.log('  adminPasswordHash hidden?       ', 'adminPasswordHash' in demo ? 'NO (BAD)' : 'yes');

console.log('\nPRODUCTS:');
for (const p of await Product.find().sort({ id: 1 }).lean()) {
  // coinsPrice set => Free (coins). null => Premium (Google Play).
  const tier = p.coinsPrice === null ? 'Premium' : 'Free   ';
  console.log(
    `  ${p.id} | ${String(p.oldId).padEnd(24)} | ${tier} | coinsPrice=${String(p.coinsPrice).padEnd(4)} | billing=${p.billingProductId}`,
  );
}

console.log(`\nCODES (first 3 of ${await Code.countDocuments()}):`);
for (const c of await Code.find().sort({ id: 1 }).limit(3).lean()) {
  console.log(`  ${c.id} | ${c.slug} | ${c.title} | ${c.coinsPrice} coins`);
}

console.log('\nDEMO TASKS (orders with type=Free, i.e. what the Home feed shows):');
for (const o of await Order.find({ type: 'Free' }).sort({ id: 1 }).lean()) {
  console.log(
    `  ${o.id} | @${String(o.username).padEnd(15)} | isLikes=${String(o.isLikes).padEnd(5)} | ${o.startCount} -> ${o.expectedCount} | ${o.status}`,
  );
}

const acct = await Account.findOne({ username: 'demo_user' }).lean();
console.log('\nACCOUNT    :', JSON.stringify({ id: acct?.id, username: acct?.username, follower: acct?.follower }));
console.log('SETTINGS   :', await Setting.countDocuments());

// Every balance must be explained by the ledger. The admin panel renders a red banner
// whenever they disagree, so a mismatch here is what a fresh install would see on screen.
console.log('\nLEDGER RECONCILIATION (coins stored vs coins accounted for):');
let drifting = 0;
for (const u of await User.find().sort({ id: 1 }).lean()) {
  const [totals] = await CoinsHistory.aggregate([
    { $match: { userId: u.id } },
    { $group: { _id: null, gained: { $sum: '$gain' }, lost: { $sum: '$lost' } } },
  ]);
  const net = (totals?.gained ?? 0) - (totals?.lost ?? 0);
  const drift = Number(u.coins ?? 0) - net;
  if (drift !== 0) drifting++;
  console.log(
    `  ${String(u.id).padStart(2)} | ${u.email.padEnd(26)} | coins=${String(u.coins).padStart(6)} | ledger=${String(net).padStart(6)} | drift=${drift}`,
  );
}
console.log(drifting === 0 ? '  => all balances reconcile' : `  => ${drifting} USER(S) DRIFTING`);

console.log('\nClient login : id=demo@ttboost.app   (no password is verified by the mobile API)');
console.log('Panel login  : admin@ttboost.app     (ADMIN_SEED_PASSWORD, default admin12345)');

process.exit(drifting === 0 ? 0 : 1);
