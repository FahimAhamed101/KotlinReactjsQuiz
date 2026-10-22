// Dump avatar mirror metadata (no bytes). Run:
//   node --import ./scripts/register-esm-hook.mjs scripts/avatar-info.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');
const { dbConnect } = await import('../lib/mongodb.js');
const mongoose = (await import('mongoose')).default;

await dbConnect();
const rows = await mongoose.connection.collection('avatars').find({}).toArray();
console.log(`avatars rows: ${rows.length}`);
for (const r of rows) {
  console.log(
    `  ${r.platform}/${r.username}  ${r.contentType}  ${r.bytes}B  ` +
      `fetched=${r.fetchedAt ? new Date(r.fetchedAt).toISOString() : '?'}  src=${String(r.sourceUrl).slice(0, 90)}`,
  );
}
process.exit(0);
