import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));
const db = (await import('../lib/db.js')).default;

// 1. Put the 10-follower package back on its real id.
const moved = await db.product.findOne({ where: { id: 9999 } });
if (moved) {
  await db.product.update({ where: { id: 9999 }, data: { id: 14 } });
  console.log(`product 9999 -> 14 (${moved.actionCount} followers)`);
} else {
  console.log('product 9999 not found (already restored?)');
}

// 2. Restore the app account's balance.
const u = await db.user.findOne({ where: { email: 'demo_user@ttboost.app' } });
const upd = await db.user.update({ where: { id: u.id }, data: { coins: 5000 } });
console.log(`demo_user@ttboost.app coins: ${u.coins} -> ${upd.coins}`);

// 3. Remove the account I created by accident (the "demo_usery" typo).
const typo = await db.user.findOne({ where: { email: 'demo_usery@ttboost.app' } });
if (typo) {
  await db.user.delete({ where: { id: typo.id } });
  console.log(`removed accidental user demo_usery@ttboost.app (id=${typo.id})`);
} else {
  console.log('no demo_usery@ttboost.app to remove');
}

// 4. Confirm the package is orderable again.
const p = await db.product.findOne({ where: { id: 14 } });
console.log(`product 14 = ${p?.actionCount} followers, coinsPrice=${p?.coinsPrice}, isActive=${p?.isActive}`);
process.exit(0);
