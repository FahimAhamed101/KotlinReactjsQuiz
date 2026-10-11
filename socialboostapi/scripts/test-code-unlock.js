// End-to-end check of the coin -> source-code unlock flow.
//
//   login -> GET /v6/codes -> POST /v6/codes/unlock -> coins debited exactly
//         -> repeat the same unlock  -> already:true, nothing charged
//         -> GET /v6/codes/unlocked  -> the code is owned
//         -> the spend appears in /v6/me/history
//         -> an unaffordable code is refused with CoinsNotEnough
//
// Re-runnable: it targets a code the account does not already own, so running it
// twice in a row does not trip over its own idempotency.
//
// Run with: node scripts/test-code-unlock.js
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

async function signIn(email, username) {
  const creds = { device_name: 'unlock-test', id: email, username };
  const hashHeader = { hash: HASH };

  let r = await call('POST', '/api/v6/login', creds, null, hashHeader);
  if (!r.json.success && r.json.error_code === 'UserNotRegistered') {
    r = await call('POST', '/api/v6/register', { ...creds, is_emulator: false }, null, hashHeader);
  }
  return r.json.data?.auth?.token ?? null;
}

const coinsOf = async (token) =>
  (await call('GET', '/api/v6/me', null, token)).json.data?.user?.coins;

const ownedOf = async (token) =>
  (await call('GET', '/api/v6/codes/unlocked', null, token)).json.data?.code_ids ?? [];

(async () => {
  const token = await signIn('demo@ttboost.app', 'demo_user');
  if (!token) {
    console.log('FAIL  could not sign in as the demo user');
    process.exit(1);
  }
  console.log('--- funded account ---');

  const codes = (await call('GET', '/api/v6/codes', null, token)).json.data ?? [];
  console.log(`      ${codes.length} codes in the catalogue`);
  codes.slice(0, 4).forEach((c) => console.log(`        ${c.coins_price} coins  ${c.title}`));
  assert('catalogue is non-empty', codes.length > 0);
  assert(
    'catalogue is sorted cheapest first',
    codes.every((c, i) => i === 0 || codes[i - 1].coins_price <= c.coins_price),
  );

  const before = await coinsOf(token);
  const ownedBefore = await ownedOf(token);
  console.log(`      balance before: ${before}, already owned: ${ownedBefore.length}`);

  // Target an unowned, affordable code so the script can be run repeatedly.
  const target = codes.find(
    (c) => !ownedBefore.includes(c.code_id) && c.coins_price <= before,
  );
  if (!target) {
    console.log('SKIP  every affordable code is already unlocked');
    console.log('      (re-seed or use a funded account with unowned codes to re-test)');
    process.exit(0);
  }
  console.log(`      target: ${target.title} — ${target.coins_price} coins`);

  // --- first unlock ---
  const first = await call('POST', '/api/v6/codes/unlock', { code_id: target.code_id }, token);
  assert(
    'unlock succeeds',
    first.json.success && first.json.data?.already === false,
    `http ${first.status}, already=${first.json.data?.already}`,
  );

  const after = await coinsOf(token);
  assert(
    'coins debited exactly the coin price',
    after === before - target.coins_price,
    `${before} -> ${after}, expected ${before - target.coins_price}`,
  );
  assert(
    'the response reports the new balance',
    first.json.data?.coins === after,
    `response ${first.json.data?.coins} vs GET /me ${after}`,
  );

  // --- the repeat must be free ---
  const repeat = await call('POST', '/api/v6/codes/unlock', { code_id: target.code_id }, token);
  assert(
    'repeat unlock is idempotent (already:true)',
    repeat.json.success && repeat.json.data?.already === true,
    `already=${repeat.json.data?.already}`,
  );

  const afterRepeat = await coinsOf(token);
  assert('repeat unlock charged nothing', afterRepeat === after, `${after} -> ${afterRepeat}`);

  // --- it must show as owned ---
  const ownedAfter = await ownedOf(token);
  assert(
    'the code is now owned',
    ownedAfter.includes(target.code_id),
    `${ownedAfter.length} owned`,
  );

  // --- and the spend must be in the ledger ---
  const history = (await call('GET', '/api/v6/me/history', null, token)).json.data ?? {};
  const ledger = (history.data ?? []).find((h) => h.type === 'CodeUnlock');
  assert(
    'the spend appears in the coins ledger as CodeUnlock',
    !!ledger && ledger.lost === target.coins_price,
    ledger ? `lost=${ledger.lost}` : 'no CodeUnlock row found',
  );

  // --- unknown code must be refused ---
  const bogus = await call('POST', '/api/v6/codes/unlock', { code_id: 'not-a-real-code' }, token);
  assert(
    'an unknown code is refused with ProductNotFound',
    !bogus.json.success && bogus.json.error_code === 'ProductNotFound',
    `got ${bogus.json.error_code ?? 'success'}`,
  );

  // --- unaffordable code must be refused ---
  console.log('\n--- unfunded account ---');
  const poorToken = await signIn('storeflow2@ttboost.app', 'storeflow2');
  assert('low-balance login', !!poorToken);

  if (poorToken) {
    const poorCoins = await coinsOf(poorToken);
    const dearest = codes[codes.length - 1];
    assert(
      'account is short of the dearest code',
      poorCoins < dearest.coins_price,
      `${poorCoins} < ${dearest.coins_price}`,
    );

    const refused = await call(
      'POST',
      '/api/v6/codes/unlock',
      { code_id: dearest.code_id },
      poorToken,
    );
    assert(
      'unaffordable unlock refused with CoinsNotEnough',
      !refused.json.success && refused.json.error_code === 'CoinsNotEnough',
      `got ${refused.json.error_code ?? 'success'}`,
    );

    const poorAfter = await coinsOf(poorToken);
    assert(
      'refused unlock left the balance alone',
      poorAfter === poorCoins,
      `${poorCoins} -> ${poorAfter}`,
    );
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
