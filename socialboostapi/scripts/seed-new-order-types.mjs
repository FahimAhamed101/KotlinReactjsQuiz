// Add the Shares / Comments / Views catalogue: one product type each, plus coin-priced
// packages on the same ladder the Likes type uses.
//
// Idempotent — re-running creates nothing that already exists, so it is safe against the
// live database.
//
//   node --import ./scripts/register-esm-hook.mjs scripts/seed-new-order-types.mjs
//
// Pricing: the buyer pays more per action than the performer earns, which is the same margin
// the existing catalogue uses (likes: 8 coins bought, 3 earned; follows: 10 bought, 5
// earned). Earn rates live in lib/settings.js DEFAULTS.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('./load-env.cjs').loadEnv('.env');

const { dbConnect } = await import('../lib/mongodb.js');
await dbConnect();
const db = (await import('../lib/db.js')).default;
const { nextId } = await import('../lib/models/index.js');

/** coins per single action, and the package sizes to offer. */
const CATALOGUE = [
  { name: 'Shares', coinsPerAction: 8, ladder: [10, 30, 100, 300, 1000] },
  { name: 'Comments', coinsPerAction: 15, ladder: [10, 30, 100, 300, 1000] },
  { name: 'Views', coinsPerAction: 3, ladder: [10, 30, 100, 300, 1000] },
];

for (const entry of CATALOGUE) {
  let type = await db.productType.findOne({ where: { name: entry.name } });
  if (!type) {
    const id = await nextId('product_types');
    type = await db.productType.create({ data: { id, name: entry.name } });
    console.log(`+ product type #${id} ${entry.name}`);
  } else {
    console.log(`= product type #${type.id} ${entry.name}`);
  }

  for (const actionCount of entry.ladder) {
    const coinsPrice = actionCount * entry.coinsPerAction;
    const existing = await db.product.findOne({
      where: { productTypeId: type.id, actionCount, coinsPrice },
    });
    if (existing) {
      console.log(`  = #${existing.id} ${actionCount} actions @ ${coinsPrice}c`);
      continue;
    }
    const id = await nextId('products');
    const created = await db.product.create({
      data: {
        id,
        actionCount,
        productTypeId: type.id,
        coinsPrice,
        price: null,
        billingProductId: null,
        // Existing catalogue rows are active; a product that is not active is never served.
        isActive: true,
        category: 1,
      },
    });
    console.log(`  + #${created.id} ${actionCount} actions @ ${coinsPrice}c`);
  }
}

console.log('\n--- resulting catalogue ---');
const products = await db.product.find({ include: { productType: true }, limit: 500 });
const byType = new Map();
for (const p of products) {
  const name = p.productType?.name ?? '(none)';
  if (!byType.has(name)) byType.set(name, 0);
  byType.set(name, byType.get(name) + 1);
}
for (const [name, n] of [...byType.entries()].sort()) console.log(`  ${name}: ${n}`);

process.exit(0);
