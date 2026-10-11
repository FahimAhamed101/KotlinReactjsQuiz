// Proves the request-signature guard actually rejects bad requests.
//
// Requires SIGNATURE_ENFORCED="true" in .env — with the kill-switch on (the
// default in the checked-in .env) every one of these would "pass" trivially,
// because verifySignature() returns early. The script therefore checks that the
// unsigned case is rejected FIRST and aborts with a clear message if it is not.
//
// Covers:
//   1. a correctly signed request succeeds
//   2. an unsigned request is refused with InvalidSignature
//   3. a signature for a different path is refused
//   4. a body tampered with after signing is refused
//   5. a replayed nonce is refused with DuplicateRequest
//   6. a stale timestamp is refused with RequestExpired
//   7. a signature made with the wrong key is refused
//
// Run with: node scripts/test-signature-guard.js
const crypto = require('crypto');
const { loadSignatureModule, signatureHeaders } = require('./signing.cjs');

const BASE = 'http://127.0.0.1:4000';
const HASH = crypto.createHash('sha256').update('nesyou is the best').digest('hex');

let failures = 0;

function assert(label, condition, detail = '') {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

async function call(method, urlPath, { body, headers = {} } = {}) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
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

const codeOf = (r) => r.json.error_code ?? (r.json.success ? 'success' : 'unknown');

(async () => {
  const { sign, canonicalJson } = await loadSignatureModule();

  // ---------- sign in (login only checks the hash header) ----------
  const creds = { device_name: 'sig-guard', id: 'demo@ttboost.app', username: 'demo_user' };
  const login = await call('POST', '/api/v6/login', {
    body: creds,
    headers: { hash: HASH, ...(await signatureHeaders('POST', '/api/v6/login', creds)) },
  });
  const token = login.json.data?.auth?.token;
  if (!token) {
    console.log('FAIL  could not sign in:', JSON.stringify(login.json).slice(0, 300));
    process.exit(1);
  }
  console.log('--- signed-in ---');

  // ---------- 0. is the guard even on? ----------
  const unsigned = await call('GET', '/api/v6/me', { headers: { Authorization: `Bearer ${token}` } });
  if (unsigned.json.success) {
    console.log('');
    console.log('ABORT  the guard is NOT enforcing: an unsigned request was accepted.');
    console.log('       Set SIGNATURE_ENFORCED="true" in ttboost-api/.env and restart the dev server.');
    process.exit(1);
  }
  assert('unsigned request refused with InvalidSignature', codeOf(unsigned) === 'InvalidSignature', codeOf(unsigned));

  const auth = { Authorization: `Bearer ${token}` };

  // ---------- 1. a properly signed request works ----------
  const signed = await call('GET', '/api/v6/me', {
    headers: { ...auth, ...(await signatureHeaders('GET', '/api/v6/me', null)) },
  });
  assert('correctly signed request succeeds', signed.json.success === true, codeOf(signed));

  // ---------- 2. missing headers ----------
  const noHeaders = await call('GET', '/api/v6/me', { headers: auth });
  assert('missing signature headers refused', codeOf(noHeaders) === 'InvalidSignature', codeOf(noHeaders));

  // ---------- 3. signature for a different path ----------
  const wrongPath = await call('GET', '/api/v6/me', {
    headers: { ...auth, ...(await signatureHeaders('GET', '/api/v6/me/orders', null)) },
  });
  assert('signature for another path refused', codeOf(wrongPath) === 'InvalidSignature', codeOf(wrongPath));

  // ---------- 4. body tampered with after signing ----------
  const declared = { code_id: 'cheap-code' };
  const tamperedHeaders = await signatureHeaders('POST', '/api/v6/codes/unlock', declared);
  const tampered = await call('POST', '/api/v6/codes/unlock', {
    body: { code_id: 'a-different-code' },
    headers: { ...auth, ...tamperedHeaders },
  });
  assert('tampered body refused', codeOf(tampered) === 'InvalidSignature', codeOf(tampered));

  // ---------- 5. replayed nonce ----------
  const replayHeaders = await signatureHeaders('GET', '/api/v6/me', null);
  const first = await call('GET', '/api/v6/me', { headers: { ...auth, ...replayHeaders } });
  const second = await call('GET', '/api/v6/me', { headers: { ...auth, ...replayHeaders } });
  assert('first use of a nonce succeeds', first.json.success === true, codeOf(first));
  assert('replayed nonce refused with DuplicateRequest', codeOf(second) === 'DuplicateRequest', codeOf(second));

  // ---------- 6. stale timestamp ----------
  const staleTs = String(Math.floor(Date.now() / 1000) - 3600);
  const staleNonce = crypto.randomBytes(8).toString('hex');
  const staleSig = sign({
    method: 'GET',
    path: 'api/v6/me',
    timestamp: staleTs,
    nonce: staleNonce,
    body: canonicalJson({}),
  });
  const stale = await call('GET', '/api/v6/me', {
    headers: {
      ...auth,
      'X-Signature': staleSig,
      'X-Timestamp': staleTs,
      'X-Nonce': staleNonce,
    },
  });
  assert('stale timestamp refused with RequestExpired', codeOf(stale) === 'RequestExpired', codeOf(stale));

  // ---------- 7. wrong key ----------
  const nowTs = String(Math.floor(Date.now() / 1000));
  const badNonce = crypto.randomBytes(8).toString('hex');
  const badSig = sign({
    method: 'GET',
    path: 'api/v6/me',
    timestamp: nowTs,
    nonce: badNonce,
    body: canonicalJson({}),
    key: Buffer.from('not-the-app-key', 'utf8'),
  });
  const wrongKey = await call('GET', '/api/v6/me', {
    headers: {
      ...auth,
      'X-Signature': badSig,
      'X-Timestamp': nowTs,
      'X-Nonce': badNonce,
    },
  });
  assert('signature from the wrong key refused', codeOf(wrongKey) === 'InvalidSignature', codeOf(wrongKey));

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
