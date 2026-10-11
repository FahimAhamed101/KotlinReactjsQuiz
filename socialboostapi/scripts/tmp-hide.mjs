import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));
const db = (await import('../lib/db.js')).default;
const u = await db.user.findOne({ where: { email: 'demo_user@ttboost.app' } });
await db.user.update({ where: { id: u.id }, data: { coins: 4900 } });
// Temporarily move the 10-follower package out of the id the app has cached.
await db.product.update({ where: { id: 14 }, data: { id: 9999 } });
console.log('coins=4900; product 14 -> id 9999 (app still holds id 14)');
process.exit(0);
