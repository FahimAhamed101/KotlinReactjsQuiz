import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));
const db = (await import('../lib/db.js')).default;

const u = await db.user.findOne({ where: { email: 'demo_user@ttboost.app' } });
console.log(`demo_user@ttboost.app id=${u.id} coins=${u.coins}`);

const orders = await db.order.find({ where: { userId: u.id }, sort: { id: 'desc' } });
console.log(`\norders: ${orders.length}`);
for (const o of orders.slice(0, 4)) {
  const p = await db.product.findOne({ where: { id: o.productId } });
  console.log(
    `  id=${o.id} productId=${o.productId} (${p ? `${p.actionCount} followers` : 'unknown'}) ` +
      `status=${o.status} url=${o.url}`,
  );
}
const led = await db.coinsHistory.find({ where: { userId: u.id }, sort: { id: 'desc' } });
console.log(`\nlatest ledger:`);
for (const h of led.slice(0, 3)) {
  console.log(`  id=${h.id} type=${h.type} lost=${h.lost ?? '-'} count=${h.count}`);
}
process.exit(0);
