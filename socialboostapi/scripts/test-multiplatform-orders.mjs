// End-to-end: place real orders for TikTok, Instagram and Facebook and prove each one is
// resolved by ITS OWN provider.
//
// This is the test that matters for the feature the user asked for — "can users order and
// buy likes/followers for TikTok, Instagram and Facebook pages by order". Everything
// upstream (profiles.js, posts.js, platform-scoped Account rows) only matters if the
// actual POST /api/v6/orders call ends up querying the right network.
//
// What proves the dispatch worked, per order:
//   * 200, not the "Could not read that post/profile" refusal
//   * `platform` echoed back as the one that was asked for
//   * `url` rewritten into that platform's canonical shape
//   * `start_count > 0` — only possible if a LIVE provider call for that network succeeded
//     (a TikTok-scraper call against an Instagram handle returns null, and the order is
//     refused before it is ever created)
//   * for likes, `post_id` recovered from the pasted link
//
// Calls are paced ~2s: RapidAPI throttles bursts and a throttled call looks exactly like
// a missing target.
//
// Run with the dev server on :4100 —
//   node --import ./scripts/register-esm-hook.mjs scripts/test-multiplatform-orders.mjs

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
require('./load-env.cjs').loadEnv(join(here, '..', '.env'));

const { buildSignatureHeaders } = await import('../lib/signature.js');

const BASE = 'http://127.0.0.1:4100';
const hash = createHash('sha256').update(process.env.HASH_VALUE || '').digest('hex');
const pause = () => new Promise((r) => setTimeout(r, 2000));

let pass = 0;
let fail = 0;
function expect(label, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

function signed(method, path, body, extra = {}) {
  return {
    Accept: 'application/json',
    ...extra,
    ...buildSignatureHeaders({
      method,
      // Pathname only — the server strips the query before signing.
      path: path.split('?')[0].replace(/^\/+/, ''),
      body: body ?? {},
    }),
  };
}

async function req(method, path, body, extra = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: signed(method, path, body, { 'Content-Type': 'application/json', ...extra }),
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  return { status: res.status, json, text };
}

/**
 * The user's coin balance.
 *
 * There is no `/v6/coins` route — coins live on the user block of `/v6/me`, which is
 * where the Android client reads them. Asking the wrong route returned a 404 HTML page,
 * so this logged `null` and made the balance look unavailable.
 */
async function readCoins(auth) {
  const me = await req('GET', '/api/v6/me', {}, auth);
  return me.json?.data?.user?.coins ?? null;
}

// --- log in as the probe user -------------------------------------------------
console.log('\n=== login ===');
const login = await req('POST', '/api/v6/login', {
  device_name: 'multi-platform-order-probe',
  id: 'facebook@facebook.ttboost.app',
  username: 'facebook',
  platform: 'facebook',
}, { hash });

console.log(`  login: ${login.status} ${login.json?.error_code ?? ''}`);
const token = login.json?.data?.auth?.token;
if (!token) {
  console.error('  cannot continue without a token');
  process.exit(1);
}
const auth = { Authorization: `Bearer ${token}` };

const coinsBefore = await readCoins(auth);
console.log(`  coins before: ${coinsBefore}`);

// --- the orders ---------------------------------------------------------------
//
// Product 14 = 10 Followers (100 coins), product 26 = 10 Likes (80 coins). Both are
// coin-priced, so the order is created in Progress immediately and start_count is
// computed synchronously from the provider.
const FOLLOWER_PRODUCT = 14;
const LIKES_PRODUCT = 26;

const CASES = [
  {
    label: 'instagram followers',
    body: {
      platform: 'instagram',
      username: 'fahim_prime3000',
      sec_uid: 'fahim_prime3000',
      url: 'https://www.instagram.com/fahim_prime3000/',
      product_id: String(FOLLOWER_PRODUCT),
    },
    expect: { platform: 'instagram', urlIncludes: 'instagram.com/fahim_prime3000', isLikes: false },
  },
  {
    label: 'facebook followers',
    body: {
      platform: 'facebook',
      username: 'facebook',
      sec_uid: 'facebook',
      url: 'https://www.facebook.com/facebook',
      product_id: String(FOLLOWER_PRODUCT),
    },
    expect: { platform: 'facebook', urlIncludes: 'facebook.com/facebook', isLikes: false },
  },
  {
    label: 'tiktok followers',
    body: {
      platform: 'tiktok',
      username: 'fahim1000011',
      sec_uid: 'MS4wLjABAAAA18WSbFnidj1ajE694xO6GbkyR8l1P48mmpdeHuj-UT9U_IKNhkuGlzTcY4DWiDXh',
      url: 'https://www.tiktok.com/@fahim1000011',
      product_id: String(FOLLOWER_PRODUCT),
    },
    expect: { platform: 'tiktok', urlIncludes: 'tiktok.com/@fahim1000011', isLikes: false },
  },
  {
    label: 'instagram likes',
    body: {
      platform: 'instagram',
      username: 'fahim_prime3000',
      sec_uid: 'fahim_prime3000',
      url: 'https://www.instagram.com/p/tsxp1hhQTG/',
      post_pk: 'tsxp1hhQTG',
      product_id: String(LIKES_PRODUCT),
    },
    expect: { platform: 'instagram', urlIncludes: 'instagram.com', isLikes: true, postId: 'tsxp1hhQTG' },
  },
  {
    label: 'facebook likes',
    body: {
      platform: 'facebook',
      username: 'facebook',
      sec_uid: 'facebook',
      url: 'https://www.facebook.com/facebook/posts/1710463914458955',
      post_pk: '1710463914458955',
      product_id: String(LIKES_PRODUCT),
    },
    expect: { platform: 'facebook', urlIncludes: 'facebook.com', isLikes: true, postId: '1710463914458955' },
  },
];

const created = [];

for (const c of CASES) {
  console.log(`\n=== ${c.label} ===`);
  const res = await req('POST', '/api/v6/orders', c.body, auth);

  if (res.status !== 200) {
    expect(`${c.label}: order accepted`, false, `HTTP ${res.status} ${res.json?.error_code ?? ''} ${res.json?.message ?? ''}`);
    await pause();
    continue;
  }

  const o = res.json?.data ?? {};
  created.push(o.id);
  expect(`${c.label}: order accepted`, true, `order #${o.id}`);
  expect(`${c.label}: platform echoed as ${c.expect.platform}`, o.platform === c.expect.platform, String(o.platform));
  expect(`${c.label}: url is ${c.expect.urlIncludes}`, String(o.url ?? '').includes(c.expect.urlIncludes), String(o.url));
  expect(`${c.label}: is_likes=${c.expect.isLikes}`, o.is_likes === c.expect.isLikes, String(o.is_likes));
  // start_count > 0 is the proof a live provider call for THIS network succeeded.
  expect(`${c.label}: live start_count > 0`, Number(o.start_count ?? 0) > 0, String(o.start_count));
  expect(`${c.label}: expected_count = start + bonus`, Number(o.expected_count ?? 0) > Number(o.start_count ?? 0), `${o.start_count} -> ${o.expected_count}`);
  if (c.expect.postId) {
    expect(`${c.label}: post_id recovered from link`, o.post_id === c.expect.postId, String(o.post_id));
  }

  await pause();
}

// --- a profile link must still be refused as a likes order --------------------
console.log('\n=== profile link is not a post (must be refused) ===');
const bad = await req('POST', '/api/v6/orders', {
  platform: 'facebook',
  username: 'facebook',
  sec_uid: 'facebook',
  url: 'https://www.facebook.com/facebook',
  product_id: String(LIKES_PRODUCT),
}, auth);
expect('facebook profile link refused as a likes order', bad.status !== 200, `HTTP ${bad.status} ${bad.json?.error_code ?? ''}`);

// --- the order feed must render them --------------------------------------
console.log('\n=== order history carries the platform ===');
const mine = await req('GET', '/api/v6/me/orders?page=1', {}, auth);
// The rows sit two levels down: the envelope's `data` is the Laravel paginator and the
// orders are that paginator's own `data`. The Android client reads the same path —
// `call()` returns the envelope's `data`, then `fetchMyOrders` reads
// `optJSONArray("data")` off it.
//
// An earlier version of this test read `data` directly and so reported "0 items" for a
// user that demonstrably had five orders, which looked exactly like a broken endpoint.
const items = Array.isArray(mine.json?.data?.data)
  ? mine.json.data.data
  : Array.isArray(mine.json?.data)
    ? mine.json.data
    : [];
console.log(
  `  my-orders: ${mine.status}, ${items.length} item(s), total=${mine.json?.data?.total}`,
);
for (const wanted of ['instagram', 'facebook', 'tiktok']) {
  const hit = items.find((i) => i.platform === wanted);
  expect(`history has a ${wanted} order with a platform tag`, !!hit, hit ? `#${hit.id} url=${hit.url}` : 'none');
}

// --- cleanup: remove the probe orders, refunding is not needed (dev data) ---
console.log('\n=== cleanup ===');
let removed = 0;
for (const id of created) {
  const del = await req('DELETE', '/api/v6/orders', { order_id: id }, auth);
  if (del.status === 200) removed++;
}
console.log(`  withdrew ${removed}/${created.length} probe order(s) (only Pending ones can be deleted)`);

const coinsAfter = await readCoins(auth);
console.log(`  coins after: ${coinsAfter}`);

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`}  pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
