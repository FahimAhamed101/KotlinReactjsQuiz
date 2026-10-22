// Dump code prices and store products. Run:
//   node --import ./scripts/register-esm-hook.mjs scripts/catalog-info.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');
const db = (await import('../lib/db.js')).default;

const codes = await db.code.find({ sort: { coinsPrice: 'asc' } });
console.log(`codes: ${codes.length}`);
for (const c of codes) {
  console.log(`  slug=${c.slug} | id=${c.id} | ${c.coinsPrice} coins | active=${c.isActive} | ${c.title ?? ''}`);
}

const products = await db.product.find({ include: { productType: true }, sort: { id: 'asc' } });
console.log(`\nproducts: ${products.length}`);
for (const p of products) {
  console.log(
    `  id=${p.id} type=${p.productType?.name} count=${p.actionCount} ` +
      `coins=${p.coinsPrice} price=${p.price} billing=${p.billingProductId} active=${p.isActive}`,
  );
}
process.exit(0);
