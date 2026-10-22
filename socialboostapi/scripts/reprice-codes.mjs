// Re-price the source-code catalogue to an affordable ladder.
//
// Run: node --import ./scripts/register-esm-hook.mjs scripts/reprice-codes.mjs
//
// Prices are assigned by RANK (cheapest existing code gets the cheapest new price), not by
// scaling the old number. That makes the script idempotent: a second run sees the same
// ordering and writes the same values, so it can be re-run safely.
//
// Old range was 699-2499 coins. At 5 coins per follow that was 140-500 follows for a single
// code. The new ladder is 49-209, i.e. roughly 10-42 follows, or one to two daily bonuses.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');
const db = (await import('../lib/db.js')).default;

// One step per code in the catalogue, cheapest first.
const LADDER = [49, 59, 69, 79, 89, 99, 109, 119, 129, 139, 149, 159, 169, 179, 189, 199, 209];

const codes = await db.code.find({ sort: { coinsPrice: 'asc' } });
console.log(`codes: ${codes.length}`);

let changed = 0;
for (let i = 0; i < codes.length; i++) {
  const code = codes[i];
  const price = LADDER[Math.min(i, LADDER.length - 1)];
  if (code.coinsPrice === price) continue;
  await db.code.update({ where: { id: code.id }, data: { coinsPrice: price } });
  console.log(`  ${code.slug}  ${code.coinsPrice} -> ${price}  (${code.title})`);
  changed++;
}

console.log(`\nupdated ${changed} of ${codes.length} codes`);
process.exit(0);
