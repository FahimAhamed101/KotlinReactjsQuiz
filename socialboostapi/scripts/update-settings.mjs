import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

const { dbConnect } = await import('../lib/mongodb.js');
const { Setting } = await import('../lib/models/index.js');

await dbConnect();
await Setting.updateOne({ key: 'tokenExpiresIn' }, { $set: { value: '43200' } }, { upsert: true });
await Setting.updateOne({ key: 'maxPendingOrdersPerUser' }, { $set: { value: '100' } }, { upsert: true });
await Setting.updateOne({ key: 'maxOrdersPerUser' }, { $set: { value: '100' } }, { upsert: true });
await Setting.updateOne({ key: 'allowTestCard' }, { $set: { value: '1' } }, { upsert: true });

const { Order } = await import('../lib/models/index.js');
const delResult = await Order.deleteMany({ id: { $nin: [1, 3] } });
console.log('Cleaned up old orders, deleted:', delResult.deletedCount);
const remaining = await Order.find().lean();
console.log('Remaining orders in DB:', remaining.map(o => ({ id: o.id, username: o.username, isLikes: o.isLikes, status: o.status })));

console.log('Settings and orders cleaned successfully!');
process.exit(0);
