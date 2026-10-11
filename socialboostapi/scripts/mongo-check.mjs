// Verify the MongoDB connection, that every model registers its indexes, and that
// every unique index is actually *enforceable*.
//
// Run with:
//   node --import ./scripts/register-esm-hook.mjs scripts/mongo-check.mjs
//
// `syncIndexes()` is what creates the unique indexes this app depends on — notably
// code_unlocks (userId, codeId), which is the primitive that makes unlocking a code
// idempotent. A model that loads but has no index would look fine and silently allow
// double charges, so this prints them.
//
// It reads the indexes back from the SERVER rather than trusting the schema, and it
// distinguishes `sparse` from `partialFilterExpression`. That distinction is not
// cosmetic: a sparse index does not skip documents whose field is present and null,
// so pairing `sparse: true` with `default: null` produces an index that rejects the
// second row with a null value — an E11000 that only appears on the second insert.
// Reporting a bare "unique: purchaseToken" hid exactly that, which is why the checks
// below are explicit about which mechanism provides the uniqueness.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

const { dbConnect, transport } = await import('../lib/mongodb.js');
const models = await import('../lib/models/index.js');

const conn = await dbConnect();
// `dbConnect()` resolves to a mongoose Connection, which exposes the native driver
// database as `.db`. (`.connection.db` is the spelling for the Mongoose *instance*,
// which is a different object — reaching for it here yields undefined.)
const nativeDb = conn.db ?? conn.connection?.db;

console.log(`transport : ${transport()}`);
console.log(`host      : ${conn.host}`);
console.log(`database  : ${conn.name}`);
console.log('');

/** How does this index restrict which documents it applies to? */
function kindOf(idx) {
  if (idx.partialFilterExpression) return `partial(${JSON.stringify(idx.partialFilterExpression)})`;
  if (idx.sparse) return 'SPARSE';
  return 'plain';
}

let problems = 0;
let sparseTraps = 0;

for (const [name, Model] of Object.entries(models)) {
  if (typeof Model?.syncIndexes !== 'function') continue; // skip nextId()

  await Model.syncIndexes();
  const docs = await Model.countDocuments();
  const live = await nativeDb.collection(Model.collection.collectionName).indexes();

  const described = [];
  for (const idx of live) {
    if (idx.name === '_id_') continue;

    const fields = Object.keys(idx.key).join('+');
    if (!idx.unique) continue;

    const kind = kindOf(idx);

    // A unique index is only safe on a nullable column if it filters out the
    // absent/null case. Detect the dangerous combination rather than trusting
    // that the schema author remembered.
    const nullable = Object.keys(idx.key).some(
      (f) => Model.schema.path(f) && Model.schema.path(f).defaultValue === null,
    );

    if (nullable && !idx.partialFilterExpression) {
      console.log(`  !! ${name}.${fields} is unique on a nullable field but ${kind}`);
      console.log(`     the second row with null will fail with E11000.`);
      console.log(`     Use uniqueWhenPresent('${Object.keys(idx.key)[0]}') from lib/models/_base.js`);
      problems++;
    }
    if (idx.sparse) sparseTraps++;

    described.push(`${fields}[${kind === 'plain' ? 'unique' : kind}]`);
  }

  const flagged = described.length ? `  unique: ${described.join(', ')}` : '';
  console.log(`${name.padEnd(28)} docs=${String(docs).padStart(4)}${flagged}`);

  if (Model.modelName !== name) {
    console.log(`  !! model name mismatch: ${Model.modelName}`);
    problems++;
  }
}

console.log('');
if (sparseTraps) {
  console.log(`${sparseTraps} sparse index(es) remain — sparse does not skip null-valued`);
  console.log('documents, so these are only correct if the field is genuinely absent.');
}
console.log(problems === 0 ? 'MODELS OK' : `${problems} PROBLEM(S)`);
await conn.close();
process.exit(problems === 0 ? 0 : 1);
