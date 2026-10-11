// CLI seed runner.
//
// Run with:
//   node --import ./scripts/register-esm-hook.mjs scripts/seed.mjs
//
// `.env` is loaded BEFORE importing lib/seed.js, because lib/mongodb.js throws at
// module load when MONGODB_URI is missing — that is the point of it, but it means the
// import has to be dynamic and come after the env is in place.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

const { runSeed } = await import('../lib/seed.js');

const summary = await runSeed();

console.log('seeded:');
for (const [k, v] of Object.entries(summary)) {
  console.log(`  ${k.padEnd(12)} ${typeof v === 'object' ? JSON.stringify(v) : v}`);
}

console.log('\nnow in the database:');
for (const [k, v] of Object.entries(summary.counts)) {
  console.log(`  ${k.padEnd(16)} ${v}`);
}

console.log('\nDemo client login : id=demo@ttboost.app  username=demo_user');
console.log(`Admin panel login : ${summary.admin}  (password from ADMIN_SEED_PASSWORD, default admin12345)`);

process.exit(0);
