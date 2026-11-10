// Migrate the platform-identity indexes on the live database.
//
// WHY THIS IS A SCRIPT AND NOT `syncIndexes()`
// -------------------------------------------
// Changing `username: { unique: true }` to a compound (platform, username) unique index
// does NOT remove the old single-field index. Mongo keeps enforcing it, so the schema
// reads as fixed while the second `@demo` (a different person on Instagram) still fails
// with E11000 duplicate key. The stale index has to be dropped by name.
//
// What this does, in order:
//   1. Reads the indexes currently on the server (not the schema — the schema is the
//      intent, the server is the truth).
//   2. Backfills `platform: 'tiktok'` onto rows that predate the field. Every existing
//      row really is TikTok: the column did not exist when only TikTok could sign in.
//   3. Drops the stale single-field UNIQUE indexes on accounts.username and
//      follow_counts.username.
//   4. Creates the compound unique indexes from the schema.
//
// Safe to re-run: every step is idempotent, and step 3 only removes an index that step 4
// immediately replaces with a strictly weaker (but correct) constraint — there is no
// window in which a duplicate could be inserted by this script itself, and the app is the
// only writer.
//
// Run with:
//   node --import ./scripts/register-esm-hook.mjs scripts/sync-platform-indexes.mjs

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

const { dbConnect } = await import('../lib/mongodb.js');
const models = await import('../lib/models/index.js');

const conn = await dbConnect();
const native = conn.db ?? conn.connection?.db;

// The collections whose identity is (platform, username), and the legacy index name that
// a bare `unique: true` would have produced.
const TARGETS = [
  { collection: 'accounts', staleUnique: 'username_1', Model: () => models.Account, fields: ['platform', 'username'] },
  { collection: 'follow_counts', staleUnique: 'username_1', Model: () => models.FollowCount, fields: ['platform', 'username'] },
];

// Collections that need the field backfilled but have no stale unique index. Every row
// here predates platforms, and only TikTok could sign in back then — so 'tiktok' is the
// factually correct value, not a default chosen for convenience.
const BACKFILL_ONLY = ['orders', 'like_counts'];

console.log(`host     : ${conn.host}`);
console.log(`database : ${conn.name}\n`);

for (const name of BACKFILL_ONLY) {
  const col = native.collection(name);
  const missing = await col.countDocuments({ platform: { $exists: false } });
  if (missing === 0) {
    console.log(`=== ${name} === platform already present on every row\n`);
    continue;
  }
  const res = await col.updateMany(
    { platform: { $exists: false } },
    { $set: { platform: 'tiktok' } },
  );
  console.log(`=== ${name} === backfilled platform='tiktok' on ${res.modifiedCount} row(s)\n`);
}

for (const target of TARGETS) {
  const col = native.collection(target.collection);
  console.log(`=== ${target.collection} ===`);

  // --- 1. Backfill ---------------------------------------------------------
  const missing = await col.countDocuments({ platform: { $exists: false } });
  if (missing > 0) {
    const res = await col.updateMany(
      { platform: { $exists: false } },
      { $set: { platform: 'tiktok' } },
    );
    console.log(`  backfilled platform='tiktok' on ${res.modifiedCount} row(s)`);
  } else {
    console.log(`  platform already present on every row`);
  }

  // --- 2. Drop the stale single-field unique index -------------------------
  const before = await col.indexes();
  const stale = before.find(
    (i) => i.name === target.staleUnique && i.unique && Object.keys(i.key).length === 1,
  );
  if (stale) {
    await col.dropIndex(target.staleUnique);
    console.log(`  dropped stale UNIQUE index ${target.staleUnique}`);
  } else {
    console.log(`  no stale single-field unique index to drop`);
  }

  // --- 3. Create the compound unique index from the schema ----------------
  const Model = target.Model();
  const created = await Model.createIndexes();
  console.log(`  createIndexes() -> ${JSON.stringify(created)}`);

  // --- 4. Report what is actually live now --------------------------------
  const after = await col.indexes();
  for (const i of after) {
    const bits = [];
    if (i.unique) bits.push('UNIQUE');
    if (i.partialFilterExpression) bits.push(`partial=${JSON.stringify(i.partialFilterExpression)}`);
    console.log(`    ${i.name}  ${JSON.stringify(i.key)}  ${bits.join(' ')}`);
  }
  console.log('');
}

await conn.close();
console.log('done');
