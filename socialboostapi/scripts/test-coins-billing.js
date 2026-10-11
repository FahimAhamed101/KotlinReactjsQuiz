// Coins billing endpoints: spin, purchase, pre-check/follow.
//
// Run with (dev server must be up on :4000):
//   node scripts/test-coins-billing.js
//
// The property that matters here is negative: *no* path may move a balance without a
// receipt Google has verified. So most of these checks assert that the balance is
// unchanged after a request that was supposed to be refused. A test that only checked the
// happy path would pass just as happily on an endpoint that pays out unconditionally.
const crypto = require('crypto');
const { signatureHeaders } = require('./signing.cjs');

const BASE = 'http://127.0.0.1:4000';
const HASH = crypto.createHash('sha256').update('nesyou is the best').digest('hex');

async function call(method, path, body, token, extraHeaders = {}) {
  const headers = {
    Accept: 'application/json',
    ...(await signatureHeaders(method, path, body)),
    ...extraHeaders,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

let failures = 0;
let checks = 0;

function ok(label, condition, detail = '') {
  checks++;
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function signIn(email, username) {
  const creds = { device_name: 'billing-test', id: email, username };
  const hashHeader = { hash: HASH };
  let r = await call('POST', '/api/v6/login', creds, null, hashHeader);
  if (!r.json.success && r.json.error_code === 'UserNotRegistered') {
    r = await call('POST', '/api/v6/register', { ...creds, is_emulator: false }, null, hashHeader);
  }
  return r.json.data?.auth?.token;
}

const coinsOf = async (token) =>
  (await call('GET', '/api/v6/me', null, token)).json.data?.user?.coins;

(async () => {
const token = await signIn('demo@ttboost.app', 'demo_user');
if (!token) {
  console.log('!! could not sign in — is the dev server on :4000 running?');
  process.exit(1);
}

const before = await coinsOf(token);
console.log(`demo user balance: ${before}\n`);

try {
  // ---------------------------------------------------------------
  console.log('[1] the catalogue now sells coin packs');
  const products = (await call('GET', '/api/v6/products', null, token)).json.data;
  const list = Array.isArray(products) ? products : (products?.items ?? []);
  const coinPacks = list.filter((p) => /^tt_coin_/.test(p.billing_product_id ?? ''));
  ok('the product list is non-empty', list.length > 0, `n=${list.length}`);
  ok('coin packs are present', coinPacks.length >= 2, JSON.stringify(coinPacks.map((p) => p.billing_product_id)));
  const pack = coinPacks[0];
  ok('a coin pack carries a billing_product_id', !!pack?.billing_product_id, JSON.stringify(pack));

  // ---------------------------------------------------------------
  console.log('\n[2] pre-check/follow returns the documented shape');
  const pre = await call(
    'POST',
    '/api/v6/coins/pre-check/follow',
    { tiktok_username: 'creator_anna', tt_username: 'demo_user' },
    token,
  );
  const preData = pre.json.data;
  ok('the request succeeds', pre.json.success === true, JSON.stringify(pre.json).slice(0, 200));
  ok(
    'it returns tiktok_follower and tt_following as numbers',
    typeof preData?.tiktok_follower === 'number' && typeof preData?.tt_following === 'number',
    JSON.stringify(preData),
  );
  const badUser = await call(
    'POST',
    '/api/v6/coins/pre-check/follow',
    { tiktok_username: 'not a username!', tt_username: 'demo_user' },
    token,
  );
  ok('an invalid username is rejected with 422', badUser.status === 422, String(badUser.status));

  // ---------------------------------------------------------------
  console.log('\n[3] spin refuses an unverifiable receipt and pays nothing');
  const spin = await call('POST', '/api/v6/coins/spin', { purchase_token: 'not-a-real-token' }, token);
  ok('spin does not succeed', spin.json.success === false, JSON.stringify(spin.json).slice(0, 200));
  ok('it reports an error code', !!spin.json.error_code, spin.json.error_code);
  const afterSpin = await coinsOf(token);
  ok('the balance is unchanged', afterSpin === before, `${before} -> ${afterSpin}`);

  // ---------------------------------------------------------------
  console.log('\n[4] purchase refuses an unverifiable receipt and pays nothing');
  const buy = await call(
    'POST',
    '/api/v6/coins/purchase',
    { product_id: pack.id, purchase_token: 'not-a-real-token' },
    token,
  );
  ok('purchase does not succeed', buy.json.success === false, JSON.stringify(buy.json).slice(0, 200));
  const afterBuy = await coinsOf(token);
  ok('the balance is unchanged', afterBuy === before, `${before} -> ${afterBuy}`);

  // ---------------------------------------------------------------
  console.log('\n[5] purchase validates the product before touching Play');
  const unknown = await call(
    'POST',
    '/api/v6/coins/purchase',
    { product_id: 999999, purchase_token: 'not-a-real-token' },
    token,
  );
  ok('an unknown product id is ProductNotFound, not a 500', unknown.json.error_code === 'ProductNotFound', `${unknown.status} ${unknown.json.error_code}`);

  const freeProduct = list.find((p) => p.coins_price !== null && p.coins_price !== undefined);
  if (freeProduct) {
    const asMoney = await call(
      'POST',
      '/api/v6/coins/purchase',
      { product_id: freeProduct.id, purchase_token: 'not-a-real-token' },
      token,
    );
    ok(
      'a coins-priced product cannot be bought with money',
      asMoney.json.error_code === 'ProductNotFound',
      `${asMoney.status} ${asMoney.json.error_code}`,
    );
  } else {
    ok('a coins-priced product exists to check', false, 'no coins_price in the catalogue');
  }

  // ---------------------------------------------------------------
  console.log('\n[6] spin and purchase require a signature');
  const unsigned = await fetch(`${BASE}/api/v6/coins/spin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ purchase_token: 'x' }),
  });
  const unsignedBody = await unsigned.json();
  ok('an unsigned spin is refused', unsignedBody.success === false, JSON.stringify(unsignedBody).slice(0, 160));
  ok(
    'with a signature error code',
    ['InvalidSignature', 'WrongHash', 'MissingArgument'].includes(unsignedBody.error_code),
    unsignedBody.error_code,
  );

  // ---------------------------------------------------------------
  console.log('\n[7] the balance survived every refusal');
  const final = await coinsOf(token);
  ok('no coins were created by any refused request', final === before, `${before} -> ${final}`);
} catch (e) {
  failures++;
  console.log(`\n!! threw: ${e.message}`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
console.log(failures === 0 ? 'COINS BILLING OK' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
})();
