// End-to-end check of the Store flow the Android app now uses:
//   login -> products -> coins -> place a coin order -> balance drops
//
// Two accounts are exercised:
//   demo@ttboost.app      (5000 coins) -> the happy path
//   storeflow2@ttboost.app   (30 coins) -> the "not enough coins" refusal
//
// Run with: node scripts/test-store-flow.js
const crypto = require('crypto');
const { signatureHeaders } = require('./signing.cjs');

const BASE = 'http://127.0.0.1:4000';
const HASH = crypto.createHash('sha256').update('nesyou is the best').digest('hex');

// Every request carries the X-Signature headers. The server re-derives the
// canonical string from the parsed body and the URL pathname (query excluded),
// so the signature is built from exactly those two inputs.
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

function assert(label, condition, detail = '') {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

function show(label, r) {
  const ok = r.json && r.json.success;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (http ${r.status})`);
  if (!ok) console.log('      ', JSON.stringify(r.json).slice(0, 300));
  return r.json;
}

/** login, registering on first run. */
async function signIn(email, username) {
  const creds = { device_name: 'store-test', id: email, username };
  const hashHeader = { hash: HASH };

  let r = await call('POST', '/api/v6/login', creds, null, hashHeader);
  if (!r.json.success && r.json.error_code === 'UserNotRegistered') {
    r = await call('POST', '/api/v6/register', { ...creds, is_emulator: false }, null, hashHeader);
  }
  return r;
}

const coinsOf = async (token) =>
  (await call('GET', '/api/v6/me', null, token)).json.data?.user?.coins;

(async () => {
  // ================= Part A: happy path =================
  console.log('--- Part A: funded account ---');
  const a = await signIn('demo@ttboost.app', 'demo_user');
  const tokenA = a.json.data?.auth?.token;
  if (!tokenA) {
    console.log('FAIL  demo login:', JSON.stringify(a.json).slice(0, 300));
    process.exit(1);
  }
  show('demo login', a);

  const tt = a.json.data?.tiktok_info ?? {};
  const secUid = tt.secUid;
  const handle = tt.uniqueId ?? 'demo_user';
  assert('login returned a usable secUid + handle', !!secUid && !!handle, `@${handle}`);

  const products = show('GET /api/v6/products', await call('GET', '/api/v6/products', null, tokenA));
  const list = products.data ?? [];
  console.log(`      ${list.length} products`);
  list.forEach((p) =>
    console.log(
      `        id=${p.id} ${p.product_type} x${p.action_count} ` +
        (p.coins_price != null ? `${p.coins_price} coins` : `Play ${p.billing_product_id} ${p.price}`),
    ),
  );
  assert('at least one coin-priced product exists', list.some((p) => p.coins_price != null));

  const before = await coinsOf(tokenA);
  console.log(`      balance before: ${before}`);

  const body = (id) => ({
    sec_uid: secUid,
    username: handle,
    url: `https://www.tiktok.com/@${handle}`,
    product_id: String(id),
  });

  // cheapest coin package, so a 5000-coin account can always afford it
  const coinProduct = [...list]
    .filter((p) => p.coins_price != null)
    .sort((x, y) => x.coins_price - y.coins_price)[0];

  const order = await call('POST', '/api/v6/orders', body(coinProduct.id), tokenA);
  show(`POST /api/v6/orders (product ${coinProduct.id}, ${coinProduct.coins_price} coins)`, order);
  if (order.json.success) {
    console.log(
      `      order #${order.json.data?.id} status=${order.json.data?.status} ` +
        `type=${order.json.data?.type} for @${order.json.data?.username}`,
    );
  }

  const after = await coinsOf(tokenA);
  assert(
    'balance dropped by exactly the coin price',
    after === before - coinProduct.coins_price,
    `${before} -> ${after}, expected ${before - coinProduct.coins_price}`,
  );

  // A Play-priced product must create a Pending order and never touch coins.
  const playProduct = list.find((p) => p.coins_price == null);
  if (playProduct) {
    const playOrder = await call('POST', '/api/v6/orders', body(playProduct.id), tokenA);

    // Two outcomes are legitimate: the order is created Pending, or the
    // per-user pending-order cap (maxPendingOrdersPerUser) refuses it — which
    // happens naturally once this script has run a few times. Both must leave
    // the coin balance untouched, and that is the property under test.
    const pending = playOrder.json.success && playOrder.json.data?.status === 'Pending';
    const capped = playOrder.json.error_code === 'OrdersLimitExceeded';
    assert(
      'Play product creates a Pending order, or is capped by maxPendingOrdersPerUser',
      pending || capped,
      pending ? 'created Pending' : `got ${playOrder.json.error_code ?? 'success'}`,
    );

    const finalBalance = await coinsOf(tokenA);
    assert('coins untouched by the Play order', finalBalance === after, `${after} -> ${finalBalance}`);
  }

  const feed = await call(
    'GET',
    `/api/v6/orders?page=1&sec_uid=${encodeURIComponent(secUid)}`,
    null,
    tokenA,
  );
  assert('GET /api/v6/orders still serves a feed', !!feed.json.success);

  // ================= Part B: refusal path =================
  console.log('\n--- Part B: unfunded account ---');
  const b = await signIn('storeflow2@ttboost.app', 'storeflow2');
  const tokenB = b.json.data?.auth?.token;
  assert('low-balance login', !!tokenB);

  if (tokenB) {
    const coinsB = await coinsOf(tokenB);
    const dearest = [...list]
      .filter((p) => p.coins_price != null)
      .sort((x, y) => y.coins_price - x.coins_price)[0];

    assert(
      'account is genuinely short of the cheapest package',
      coinsB < coinProduct.coins_price,
      `${coinsB} < ${coinProduct.coins_price}`,
    );

    const ttB = b.json.data?.tiktok_info ?? {};
    const refused = await call(
      'POST',
      '/api/v6/orders',
      {
        sec_uid: ttB.secUid,
        username: ttB.uniqueId ?? 'storeflow2',
        url: `https://www.tiktok.com/@${ttB.uniqueId ?? 'storeflow2'}`,
        product_id: String(dearest.id),
      },
      tokenB,
    );
    assert(
      'overspend refused with CoinsNotEnough',
      !refused.json.success && refused.json.error_code === 'CoinsNotEnough',
      `got ${refused.json.error_code ?? 'success'} for a ${dearest.coins_price}-coin package`,
    );

    const coinsBAfter = await coinsOf(tokenB);
    assert('refused order left the balance alone', coinsBAfter === coinsB, `${coinsB} -> ${coinsBAfter}`);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
