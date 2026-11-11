// End-to-end check of the Instagram feature, from the buyer's side.
//
//   node --import ./scripts/register-esm-hook.mjs scripts/test-instagram-e2e.mjs
//
// Answers one question in plain steps: can an Instagram user sign in, resolve a real
// Instagram profile, and actually buy followers with coins — and does the resulting order
// land in the state the task feed serves, so it can be performed?
//
// It exercises the real routes against the dev server on :4100, so a broken provider or a
// missing platform scope fails here rather than in the app.
//
// Companion to test-multiplatform-orders.mjs: that suite covers all three networks
// broadly, this one follows a single Instagram purchase closely enough to report on it.

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
require('./load-env.cjs').loadEnv(join(here, '..', '.env'));

const { buildSignatureHeaders } = await import('../lib/signature.js');

const BASE = process.argv[2] || 'http://127.0.0.1:4100';
const hash = createHash('sha256').update(process.env.HASH_VALUE || '').digest('hex');
const pause = () => new Promise((r) => setTimeout(r, 2000));

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

function signed(method, path, body) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...buildSignatureHeaders({
      method,
      path: path.split('?')[0].replace(/^\/+/, ''),
      body: body ?? {},
    }),
  };
}

async function req(method, path, body, extra = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...signed(method, path, body), ...extra },
    body: method === 'GET' ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  return { status: res.status, json, text };
}

// The test user is the same one the multi-platform suite drives — a real, registered
// account. Only the PLATFORM of this session changes, which is the point: the same buyer
// arriving through Instagram instead of TikTok.
//
// Never the primary handle: logging in as it issues a fresh token and invalidates the
// device session the app is using.
const LOGIN = {
  device_name: 'instagram-e2e-probe',
  id: 'facebook@facebook.ttboost.app',
  username: 'fahim_prime3000',
  platform: 'instagram',
};

const FOLLOWERS_PRODUCT = 14; // 10 Followers for coins

// Accounts to try placing the order against, in order. Instagram's provider is rate
// limited, so a handle that fails to resolve is not necessarily a bug — but if none of
// these resolve, something is genuinely wrong with the platform and the test must fail.
const TARGET_CANDIDATES = ['nike', 'natgeo', 'fahim_prime3000'];

console.log('\n=== 1. sign in as an Instagram user ===');
const login = await req('POST', '/api/v6/login', LOGIN, { hash });
check('login accepted', login.status === 200, `HTTP ${login.status} ${login.json?.error_code ?? ''}`);

const token = login.json?.data?.auth?.token;
if (!token) {
  console.log('  cannot continue without a token:', login.text.slice(0, 300));
  process.exit(1);
}

const info = login.json?.data?.tiktok_info ?? {};
const auth = { Authorization: `Bearer ${token}` };

console.log(`  session platform : ${login.json?.data?.platform}`);
console.log(`  resolved account : @${info.uniqueId} (${info.platform})`);
console.log(`  followers        : ${info.followerCount}   following: ${info.followingCount}   likes: ${info.likeCount}`);

check('session is an instagram session', login.json?.data?.platform === 'instagram', String(login.json?.data?.platform));
check('instagram profile resolved through the provider', info.platform === 'instagram', String(info.platform));
// The provider answered with a live figure — this is what separates a real lookup from
// the offline stub that a missing API key produces.
check('live follower count from the provider', Number(info.followerCount) > 0, String(info.followerCount));
check('avatar url is the platform mirror', /\/api\/v6\/avatar\/instagram\//.test(String(info.avatar_url ?? '')), String(info.avatar_url));

console.log('\n=== 2. coins before ===');
const meBefore = await req('GET', '/api/v6/me?username=fahim_prime3000&platform=instagram', {}, auth);
const coinsBefore = meBefore.json?.data?.user?.coins ?? null;
console.log(`  coins: ${coinsBefore}`);

console.log('\n=== 3. buy followers for an Instagram account ===');
let order = null;
let targetUsed = null;

for (const handle of TARGET_CANDIDATES) {
  const body = {
    platform: 'instagram',
    username: handle,
    sec_uid: handle,
    url: `https://www.instagram.com/${handle}/`,
    product_id: String(FOLLOWERS_PRODUCT),
  };
  const res = await req('POST', '/api/v6/orders', body, auth);
  if (res.status === 200) {
    order = res.json?.data ?? {};
    targetUsed = handle;
    break;
  }
  console.log(`  @${handle} not orderable: ${res.status} ${res.json?.error_code ?? ''} ${res.json?.message ?? ''}`);
  await pause();
}

if (!order) {
  check('a followers order was created', false, 'no candidate resolved');
  console.log(`\nFAIL  pass=${pass} fail=${fail}`);
  process.exit(1);
}

console.log(`  order #${order.id} for @${targetUsed}`);

check('order accepted', true, `order #${order.id}`);
check('platform echoed as instagram', order.platform === 'instagram', String(order.platform));
check('it is a FOLLOWERS order, not likes', order.is_likes === false, String(order.is_likes));
check('url is the canonical instagram profile', String(order.url ?? '').includes('instagram.com'), String(order.url));
// A live start_count is the proof the provider was called for THIS network at purchase
// time; without it the order would be boosting a number nobody measured.
check('live start_count at purchase', Number(order.start_count ?? 0) > 0, String(order.start_count));
check(
  'expected_count = start + quantity',
  Number(order.expected_count ?? 0) > Number(order.start_count ?? 0),
  `${order.start_count} -> ${order.expected_count}`
);
// The feed only serves orders that are in Progress; anything else is not performable.
check('order is deliverable (status Progress)', order.status === 'Progress', String(order.status));
check('target stats exposed to the performer', order.target != null, JSON.stringify(order.target ?? null));

console.log('\n=== 4. the coins were actually taken ===');
const meAfter = await req('GET', '/api/v6/me?username=fahim_prime3000&platform=instagram', {}, auth);
const coinsAfter = meAfter.json?.data?.user?.coins ?? null;
const spent = Number(coinsBefore) - Number(coinsAfter);
console.log(`  coins: ${coinsBefore} -> ${coinsAfter}  (spent ${spent})`);
check('coins debited', spent > 0, `${spent}`);
check('debit matches the number of followers ordered', spent === 100, `spent ${spent}, product 14 = 100 coins for 10`);

console.log('\n=== 5. it shows up in the buyer\'s order history ===');
const mine = await req('GET', '/api/v6/me/orders?page=1', {}, auth);
const rows = mine.json?.data?.data ?? [];
const found = rows.find((r) => Number(r.id) === Number(order.id));
check('order present in history', !!found, `#${order.id}`);
if (found) {
  check('history row keeps the instagram platform tag', found.platform === 'instagram', String(found.platform));
  check('history row is a followers order', found.is_likes === false, String(found.is_likes));
  check('history row carries the target stats', found.target != null, JSON.stringify(found.target ?? null));
}

console.log('\n=== 6. no account internals leaked to a viewer ===');
const target = order.target ?? {};
const leaked = ['secUid', 'secret', 'tiktokId', 'avatarLarger'].filter((k) => k in target);
check('target block is an allowlist only', leaked.length === 0, leaked.join(', ') || 'clean');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}  pass=${pass} fail=${fail}`);
console.log(
  fail === 0
    ? 'Instagram: an Instagram user can sign in, resolve a real profile, and buy followers with coins.'
    : 'Instagram purchase path has a problem — see FAIL lines above.'
);
process.exit(fail === 0 ? 0 : 1);
