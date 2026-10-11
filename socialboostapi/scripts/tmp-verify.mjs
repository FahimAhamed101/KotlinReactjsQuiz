import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));
const db = (await import('../lib/db.js')).default;

const types = await db.productType.find({});
const nameOf = Object.fromEntries(types.map((t) => [t.id, t.name]));
const products = await db.product.find({ where: { isActive: true } });

const groups = {};
for (const p of products) {
  const t = nameOf[p.productTypeId] ?? `type${p.productTypeId}`;
  const kind = p.coinsPrice != null ? 'coin' : 'cash';
  const k = `${t} ${kind}`;
  groups[k] = groups[k] ?? [];
  groups[k].push(p);
}
for (const [k, list] of Object.entries(groups).sort()) {
  console.log(`\n${k}  (${list.length})`);
  for (const p of list.sort((a, b) => a.actionCount - b.actionCount)) {
    console.log(
      `  id=${String(p.id).padEnd(4)} count=${String(p.actionCount).padEnd(6)} ` +
        `coins=${String(p.coinsPrice ?? '-').padEnd(6)} price=${String(p.price ?? '-').padEnd(8)} ` +
        `billing=${p.billingProductId ?? '-'}`,
    );
  }
}
process.exit(0);
