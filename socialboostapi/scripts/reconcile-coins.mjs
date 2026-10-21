// Reconcile a user's coin ledger with their balance, without changing the balance.
//
//   Usage: node --import ./scripts/register-esm-hook.mjs scripts/reconcile-coins.mjs <username> [all]
//
// The inverse of set-coins.mjs. `set-coins` moves the *balance* and records the delta; this
// one trusts the balance and records what the ledger is missing. That is the right tool when
// the balance is correct but the history is incomplete — for example a seeded balance, or a
// grant that predates the ledger row convention — because `db:verify` compares the two and a
// mismatch is indistinguishable from a bug later.
//
// With `all`, every user is reconciled in one pass.
//
// The row is type 'Bonus' with `gain` (or `lost` for a decrease), matching the convention
// the seed and set-coins use so the ledger stays readable to whatever reads it next.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');

const [username, mode] = process.argv.slice(2);
if (!username) {
  console.error('usage: reconcile-coins.mjs <username>|all');
  process.exit(1);
}

const { dbConnect } = await import('../lib/mongodb.js');
const { nextId } = await import('../lib/models/_base.js');
const { User, CoinsHistory } = await import('../lib/models/index.js');
const db = (await import('../lib/db.js')).default;

await dbConnect();

async function reconcileUser(user) {
  const rows = await db.coinsHistory.find({ where: { userId: user.id }, limit: 5000 });
  let net = 0;
  for (const r of rows) net += (r.gain ?? 0) - (r.lost ?? 0);

  const balance = Number(user.coins ?? 0);
  const missing = balance - net;
  if (missing === 0) {
    return { user, changed: false, before: balance, after: balance, delta: 0 };
  }

  await CoinsHistory.create({
    id: await nextId('coins_histories'),
    userId: user.id,
    // 'Bonus' is the catch-all the seed uses; a dedicated type would be more honest but
    // the ledger's readers switch on the known types and an unknown one is invisible.
    type: 'Bonus',
    gain: missing > 0 ? missing : null,
    lost: missing < 0 ? -missing : null,
    count: 1,
  });

  return { user, changed: true, before: balance, after: balance, delta: missing };
}

let targets = [];
if (mode === 'all' || username === 'all') {
  targets = await User.find({});
} else {
  const account = await db.account.findOne({ where: { username } });
  let found = null;
  if (account?.userId) found = await User.findOne({ id: account.userId });
  if (!found) found = await User.findOne({ email: `${username}@ttboost.app` });
  if (!found) found = await User.findOne({ name: username });
  if (!found) found = await User.findOne({ name: `@${username}` });
  if (!found) {
    console.error(`no user found for "${username}"`);
    process.exit(1);
  }
  targets = [found];
}

let fixed = 0;
for (const u of targets) {
  const r = await reconcileUser(u);
  if (r.changed) {
    fixed++;
    console.log(
      `reconciled ${u.email} (user ${u.id}): ledger ${r.delta > 0 ? '+' : ''}${r.delta} ` +
        `-> balance ${r.before} now agrees with history`,
    );
  }
}

console.log(fixed === 0 ? '  all balances already reconcile' : `  ${fixed} user(s) reconciled`);
process.exit(0);
