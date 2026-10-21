// Set a user's coin balance to an exact figure, recording the difference in the
// ledger so the balance never drifts.
//
//   Usage: node --import ./scripts/register-esm-hook.mjs scripts/set-coins.mjs <username> <target>
//   e.g.   node --import ./scripts/register-esm-hook.mjs scripts/set-coins.mjs fahim1000011 20000
//
// The balance is written directly rather than through /api/v6/coins/check, because
// the whole point here is to move a number for testing. What is NOT skipped is the
// ledger: a `coins_histories` row with `gain` is written for the delta, following the
// same `reconcileLedger` convention the seed uses (type 'Bonus'). Without it the
// balance and the ledger disagree, which is exactly the "drift" the seed comment
// warns about — and a drifted row is indistinguishable from a bug later.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');

const [username, targetArg] = process.argv.slice(2);

if (!username || targetArg === undefined) {
  console.error('usage: set-coins.mjs <username> <target-coins>');
  process.exit(1);
}

const target = Number(targetArg);
if (!Number.isInteger(target) || target < 0) {
  console.error(`target must be a non-negative integer, got: ${targetArg}`);
  process.exit(1);
}

const { dbConnect } = await import('../lib/mongodb.js');
const { nextId } = await import('../lib/models/_base.js');
const { User, CoinsHistory } = await import('../lib/models/index.js');

await dbConnect();

// Resolve the user the same way the app does: the login handle is an account
// username, and the coin balance lives on the user row it links to.
//
// Three tries, in order of reliability. `accounts.userId` is the intended link, but rows
// written before that column existed have no value there — matching on `name` alone made
// the script report "no user found" for a handle whose account existed, which is how this
// tool came to look broken for exactly the accounts an operator wants to fix.
const account = await (await import('../lib/db.js')).default.account.findOne({
  where: { username },
});

let user = null;
if (account?.userId) user = await User.findOne({ id: account.userId });
if (!user) user = await User.findOne({ email: `${username}@ttboost.app` });
if (!user) user = await User.findOne({ name: username });
if (!user) user = await User.findOne({ name: `@${username}` });

if (!user) {
  console.error(`no user found for "${username}"`);
  process.exit(1);
}

const before = Number(user.coins ?? 0);
const delta = target - before;

if (delta === 0) {
  console.log(`${username}: already at ${before} coins — nothing to do`);
  process.exit(0);
}

user.coins = target;
await user.save();

// Only write a ledger row for the change itself. `lost` is used for a decrease so
// the row stays readable in the history list the same way order rows are.
await CoinsHistory.create({
  id: await nextId('coins_histories'),
  userId: user.id,
  type: 'Bonus',
  gain: delta > 0 ? delta : null,
  lost: delta < 0 ? -delta : null,
  count: 1,
});

console.log(`${username} (user ${user.id}): ${before} -> ${target} coins  (${delta > 0 ? '+' : ''}${delta})`);
console.log(`ledger row written for ${Math.abs(delta)} coin(s) so the balance and history agree`);
process.exit(0);
