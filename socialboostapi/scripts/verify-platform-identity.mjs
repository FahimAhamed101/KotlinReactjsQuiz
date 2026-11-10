// Prove the platform-identity fix: the same handle must be storable on two networks.
//
// Before the compound (platform, username) unique index existed, the second insert died
// with E11000 on `username_1` — which made the whole multi-platform feature impossible,
// because `@demo` is a different person on TikTok and Instagram and only one could ever
// be stored. This asserts the positive case AND that a genuine duplicate within one
// platform is still rejected (the constraint must not have been weakened away).
//
// Self-cleaning: every row it creates is removed at the end.
//
// Run with:
//   node --import ./scripts/register-esm-hook.mjs scripts/verify-platform-identity.mjs
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

const db = (await import('../lib/db.js')).default;
const { dbConnect } = await import('../lib/mongodb.js');
await dbConnect();

const HANDLE = `platformid_probe_${Date.now()}`;
let pass = 0;
let fail = 0;

function check(label, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label} ${detail}`);
  }
}

console.log(`handle: ${HANDLE}\n=== same handle on two networks ===`);
try {
  await db.account.create({ data: { platform: 'tiktok', username: HANDLE, secUid: `${HANDLE}_tt` } });
  await db.account.create({ data: { platform: 'instagram', username: HANDLE, secUid: `${HANDLE}_ig` } });
  await db.account.create({ data: { platform: 'facebook', username: HANDLE, secUid: `${HANDLE}_fb` } });
  check('three rows for one handle across tiktok/instagram/facebook', true);
} catch (e) {
  check('three rows for one handle across tiktok/instagram/facebook', false, `-> ${e.message}`);
}

const found = await db.account.find({ where: { username: HANDLE } });
check('lookup by handle returns all three', found.length === 3, `-> got ${found.length}`);

// Each row must be independently addressable — this is the lookup every service does.
const SUFFIX = { tiktok: 'tt', instagram: 'ig', facebook: 'fb' };
for (const p of ['tiktok', 'instagram', 'facebook']) {
  const row = await db.account.findOne({ where: { platform: p, username: HANDLE } });
  check(`(platform=${p}, username) resolves to its own row`, row?.secUid === `${HANDLE}_${SUFFIX[p]}`);
}

// The constraint must still bite *within* one network.
console.log('\n=== duplicate within one network is still rejected ===');
let rejected = false;
try {
  await db.account.create({ data: { platform: 'tiktok', username: HANDLE, secUid: `${HANDLE}_dup` } });
} catch {
  rejected = true;
}
check('second tiktok row with the same handle is rejected', rejected);

console.log('\n=== follow_counts scopes the same way ===');
try {
  await db.followCount.create({ data: { platform: 'tiktok', username: HANDLE, followingCount: 1 } });
  await db.followCount.create({ data: { platform: 'instagram', username: HANDLE, followingCount: 2 } });
  const tt = await db.followCount.findOne({ where: { platform: 'tiktok', username: HANDLE } });
  const ig = await db.followCount.findOne({ where: { platform: 'instagram', username: HANDLE } });
  check('anchors are separate per network', tt?.followingCount === 1 && ig?.followingCount === 2);
} catch (e) {
  check('anchors are separate per network', false, `-> ${e.message}`);
}

// --- cleanup -------------------------------------------------------------
for (const collection of ['account', 'followCount']) {
  await db[collection].deleteMany({ where: { username: HANDLE } }).catch(() => {});
}
const leftover = await db.account.find({ where: { username: HANDLE } });
check('probe rows cleaned up', leftover.length === 0);

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}  pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
