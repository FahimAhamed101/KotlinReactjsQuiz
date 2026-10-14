// Proof that the "free coins" hole is closed AND that a genuine follow still pays.
//
// 1 & 2 reproduce exactly what the old client did — POST /coins/check with
// `follow_incremented: true` — WITHOUT following anyone, and assert nothing is credited.
// Before the fix this paid out on every call.
//
// 3 simulates a real follow by dropping the viewer's stored anchor one below their live
// following count, which is the precise condition a genuine follow produces.
//
// The viewer is `creator_anna` (owner0@ttboost.app), NOT the app's own user, so running
// this never invalidates the session on the phone. creator_anna is a real TikTok account
// with a non-zero following count, which is required — an account that follows nobody
// has no room to "gain" a follow.
//
// IMPORTANT: the target task must be one this viewer has NOT already been credited for.
// The server short-circuits with `already: true` and returns before the verifier runs, so
// picking a credited order makes checks 1 and 2 pass *vacuously* — they would look green
// even against a vulnerable build. That is a trap this script used to fall into.
//
// Run: node --import ./scripts/register-esm-hook.mjs scripts/verify-coins-guard.mjs <baseUrl>
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

const { buildSignatureHeaders } = await import('../lib/signature.js');
const { dbConnect } = await import('../lib/mongodb.js');
const db = (await import('../lib/db.js')).default;
const tiktok = await import('../lib/services/tiktok.js');

const base = process.argv[2] || 'http://127.0.0.1:4000';
const hash = crypto.createHash('sha256').update(process.env.HASH_VALUE || '').digest('hex');

const VIEWER_EMAIL = 'owner0@ttboost.app';
const VIEWER_HANDLE = 'creator_anna';

async function call(method, path, body, token) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    hash,
    ...buildSignatureHeaders({
      method,
      path: path.split('?')[0].replace(/^\/+/, ''),
      body: body ?? {},
    }),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text };
}

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? '  — ' + detail : ''}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? '  — ' + detail : ''}`);
  }
};

console.log(`base: ${base}`);
console.log(`viewer: ${VIEWER_HANDLE} (${VIEWER_EMAIL})\n`);

const conn = await dbConnect();

const login = await call('POST', '/api/v6/login', {
  id: VIEWER_EMAIL,
  username: VIEWER_HANDLE,
  device_name: 'guard-test',
});
const token = login.json?.data?.auth?.token;
if (!token) {
  console.error('login failed:', login.status, login.text.slice(0, 300));
  await conn.close();
  process.exit(1);
}

const me = async () => (await call('GET', '/api/v6/me', null, token)).json?.data?.user?.coins ?? 0;

const before = await me();
console.log(`coins before: ${before}\n`);

// Which orders has this viewer already been paid for? Those are unusable as targets.
const viewer = await db.user.findOne({ where: { email: VIEWER_EMAIL } });
const credited = new Set(
  (await db.coinsHistory.find({ where: { userId: viewer.id } }))
    .filter((h) => h.type === 'FollowTask' || h.type === 'LikeTask')
    .map((h) => h.orderId),
);

const feed = await call('GET', '/api/v6/orders?page=1', null, token);
const items = feed.json?.data?.items ?? [];
const followTask = items.find((i) => !i.is_likes && !credited.has(i.id));

if (!followTask) {
  console.error(
    `no *uncredited* follow task in the feed (${items.length} items, ` +
      `${credited.size} already paid to this viewer).\n` +
      'Refill the demo pool first: node --import ./scripts/register-esm-hook.mjs ' +
      'scripts/replenish-demo-tasks.mjs --confirm',
  );
  await conn.close();
  process.exit(1);
}
console.log(
  `target task: id=${followTask.id} user=${followTask.username} ` +
    `(uncredited for this viewer)\n`,
);

console.log('1) the OLD exploit — assert `follow_incremented: true` without following');
const exploit = await call(
  'POST',
  '/api/v6/coins/check',
  {
    order_id: followTask.id,
    tt_username: VIEWER_HANDLE,
    tiktok_username: followTask.username,
    follow_incremented: true,
  },
  token,
);
const afterExploit = await me();
console.log(`   response: ${JSON.stringify(exploit.json?.data ?? exploit.json)}`);
check(
  'no coins credited from a bare client assertion',
  afterExploit === before,
  `balance ${before} -> ${afterExploit}`,
);

console.log('\n2) no assertion flag at all, and still no follow');
const honest = await call(
  'POST',
  '/api/v6/coins/check',
  { order_id: followTask.id, tt_username: VIEWER_HANDLE, tiktok_username: followTask.username },
  token,
);
const afterHonest = await me();
console.log(`   response: ${JSON.stringify(honest.json?.data ?? honest.json)}`);
check(
  'an un-followed task still pays nothing',
  afterHonest === before,
  `balance ${before} -> ${afterHonest}`,
);

console.log('\n3) a genuine follow (anchor dropped one below the live count)');
const live = await tiktok.getProfileInfo(VIEWER_HANDLE, null);
console.log(`   live following for ${VIEWER_HANDLE}: ${live?.followingCount}`);

if (!live || !live.followingCount) {
  console.log('   (viewer follows nobody — nothing to simulate; skipping)');
} else {
  const anchor = await db.followCount.findOne({ where: { username: VIEWER_HANDLE } });
  const original = anchor?.followingCount ?? null;
  await db.followCount.update({
    where: { id: anchor.id },
    data: { followingCount: live.followingCount - 1 },
  });
  console.log(`   anchor: ${original} -> ${live.followingCount - 1}`);

  const real = await call(
    'POST',
    '/api/v6/coins/check',
    { order_id: followTask.id, tt_username: VIEWER_HANDLE, tiktok_username: followTask.username },
    token,
  );
  const afterReal = await me();
  console.log(`   response: ${JSON.stringify(real.json?.data ?? real.json)}`);
  check(
    'a genuine follow still credits',
    afterReal > afterHonest,
    `balance ${afterHonest} -> ${afterReal}`,
  );

  // The server re-anchors on success; just make sure it is not left below the truth.
  const now = await db.followCount.findOne({ where: { username: VIEWER_HANDLE } });
  if (now && now.followingCount < live.followingCount) {
    await db.followCount.update({
      where: { id: now.id },
      data: { followingCount: live.followingCount },
    });
    console.log(`   restored anchor to ${live.followingCount}`);
  }
}
await conn.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
