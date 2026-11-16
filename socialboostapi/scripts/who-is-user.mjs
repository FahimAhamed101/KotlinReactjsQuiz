// READ-ONLY: dump specific users + the tokens held on the phone.
//
//   node --import ./scripts/register-esm-hook.mjs scripts/who-is-user.mjs 108 64 1

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');

const { dbConnect } = await import('../lib/mongodb.js');
const db = (await import('../lib/db.js')).default;
await dbConnect();

const ids = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));

for (const id of ids) {
  const u = await db.user.findOne({ where: { id } });
  if (!u) {
    console.log(`user #${id}: (missing)`);
    continue;
  }
  const tokens = await db.personalAccessToken.find({ where: { userId: id } });
  console.log(
    `user #${id} email=${u.email} name=${u.name} coins=${u.coins} status=${u.status}\n` +
      `   tokens=[${tokens.map((t) => `${t.name}:${String(t.token).slice(0, 12)}..`).join(', ')}]`,
  );
}

console.log('\n=== every user whose email mentions fahim ===');
const users = await db.user.find({ limit: 5000 });
for (const u of users) {
  if (/fahim/i.test(String(u.email)) || /fahim/i.test(String(u.name))) {
    console.log(`  #${u.id} email=${u.email} name=${u.name} coins=${u.coins}`);
  }
}

console.log('\n=== all tokens (who else is logged in) ===');
const tokens = await db.personalAccessToken.find({ limit: 500 });
for (const t of tokens) {
  console.log(`  token userId=${t.userId} name=${t.name} token=${String(t.token).slice(0, 16)}..`);
}

process.exit(0);
