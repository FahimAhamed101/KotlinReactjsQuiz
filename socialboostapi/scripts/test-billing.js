// Billing verification rules.
//
// Run with:
//   node --import ./scripts/register-esm-hook.mjs scripts/test-billing.js
//
// Every check here is about a way to get coins without paying, so the assertions are
// deliberately paranoid. The stub `fetch` plays the part of Google: it is the only thing
// that changes between the cases, which is what makes this a test of our logic rather
// than of the network.
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

// A throwaway key so the JWT-bearer signing path is exercised for real. It never leaves
// this process and is not a credential for anything.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

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

const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  client_email: 'ttboost-test@example.iam.gserviceaccount.com',
  private_key: privateKey,
});

const googlePlay = await import('../lib/services/googlePlay.js');
const { invalidateSettingsCache } = await import('../lib/settings.js');
const { db } = await import('../lib/db.js');

const PACKAGE = googlePlay.packageName();
const PRODUCT = 'tt_coins_100';
const TOKEN = 'test-purchase-token';
const PURCHASE_URL = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/purchases/products/${PRODUCT}/tokens/${TOKEN}`;

/**
 * A stub Google.
 * @param {{purchase?: object, purchaseStatus?: number, consumeOk?: boolean, tokenStatus?: number}} opts
 */
function stubGoogle(opts = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(`${init.method ?? 'GET'} ${url}`);

    if (url === 'https://oauth2.googleapis.com/token') {
      return jsonResponse(opts.tokenStatus ?? 200, { access_token: 'stub-token', expires_in: 3600 });
    }
    if (url.endsWith(':consume')) {
      return jsonResponse(opts.consumeOk === false ? 500 : 200, {});
    }
    if (url === PURCHASE_URL) {
      return jsonResponse(opts.purchaseStatus ?? 200, opts.purchase ?? {});
    }
    return jsonResponse(404, {});
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** A purchase that should be accepted. */
const goodPurchase = {
  purchaseState: 0,
  consumptionState: 0,
  purchaseType: 1,
  orderId: 'GPA.1234-5678-9012-34567',
  obfuscatedExternalAccountId: '42',
};

async function setAllowTestCard(value) {
  await db.setting.update({ where: { key: 'allowTestCard' }, data: { value: String(value) } });
  invalidateSettingsCache();
}

try {
  // ---------------------------------------------------------------
  console.log('\n[1] an unconfigured server refuses — it does not fake a purchase');
  delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE;
  googlePlay.resetBillingCache();

  ok('hasCredentials() is false', googlePlay.hasCredentials() === false);
  const status = googlePlay.billingStatus();
  ok('billingStatus() explains what is missing', status.configured === false && /service account/i.test(status.reason), status.reason);

  let threw = null;
  try {
    await googlePlay.checkPurchase(TOKEN, PRODUCT, { fetchImpl: stubGoogle() });
  } catch (e) {
    threw = e;
  }
  ok('checkPurchase throws instead of returning paymentSuccess', !!threw, threw ? threw.code : 'returned a value');
  ok('it throws ServerError, not a success', threw?.code === 'ServerError', threw?.code);

  // ---------------------------------------------------------------
  console.log('\n[2] a configured server exchanges the service account for a token');
  process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = SERVICE_ACCOUNT;
  googlePlay.resetBillingCache();
  ok('hasCredentials() is now true', googlePlay.hasCredentials() === true);
  ok('billingStatus() reports the client email', googlePlay.billingStatus().client_email?.includes('ttboost-test'), JSON.stringify(googlePlay.billingStatus()));

  const okFetch = stubGoogle({ purchase: goodPurchase });
  const accepted = await googlePlay.checkPurchase(TOKEN, PRODUCT, { fetchImpl: okFetch });
  ok('a valid purchase is accepted', accepted.paymentSuccess === true, JSON.stringify(accepted));
  ok('the purchase was consumed', okFetch.calls.some((c) => c.includes(':consume')), okFetch.calls.join(' | '));
  ok('the token was fetched before the purchase lookup', okFetch.calls[0].includes('oauth2.googleapis.com'), okFetch.calls[0]);

  // ---------------------------------------------------------------
  console.log('\n[3] a cancelled purchase is refused');
  let r = await googlePlay.checkPurchase(TOKEN, PRODUCT, {
    fetchImpl: stubGoogle({ purchase: { ...goodPurchase, purchaseState: 1 } }),
  });
  ok('paymentSuccess is false', r.paymentSuccess === false);
  ok('it is not consumed', r.failureReason?.includes('cancelled'), r.failureReason);

  console.log('\n[3b] a response with no purchaseState at all is refused');
  r = await googlePlay.checkPurchase(TOKEN, PRODUCT, { fetchImpl: stubGoogle({ purchase: {} }) });
  ok('paymentSuccess is false', r.paymentSuccess === false, JSON.stringify(r));

  // ---------------------------------------------------------------
  console.log('\n[4] a replayed receipt is refused (the whole point of consuming)');
  r = await googlePlay.checkPurchase(TOKEN, PRODUCT, {
    fetchImpl: stubGoogle({ purchase: { ...goodPurchase, consumptionState: 1 } }),
  });
  ok('paymentSuccess is false', r.paymentSuccess === false);
  ok('the reason names the replay', /already consumed/.test(r.failureReason ?? ''), r.failureReason);

  // ---------------------------------------------------------------
  console.log('\n[5] test purchases are refused unless the setting allows them');
  await setAllowTestCard(0);
  r = await googlePlay.checkPurchase(TOKEN, PRODUCT, {
    fetchImpl: stubGoogle({ purchase: { ...goodPurchase, purchaseType: 0 } }),
  });
  ok('allowTestCard=0 refuses a test card', r.paymentSuccess === false && /test purchase/.test(r.failureReason ?? ''), r.failureReason);

  await setAllowTestCard(1);
  r = await googlePlay.checkPurchase(TOKEN, PRODUCT, {
    fetchImpl: stubGoogle({ purchase: { ...goodPurchase, purchaseType: 0 } }),
  });
  ok('allowTestCard=1 accepts a test card', r.paymentSuccess === true, JSON.stringify(r));
  await setAllowTestCard(0);

  // ---------------------------------------------------------------
  console.log('\n[6] an unknown token is refused, not treated as paid');
  r = await googlePlay.checkPurchase(TOKEN, PRODUCT, { fetchImpl: stubGoogle({ purchaseStatus: 404 }) });
  ok('a 404 means paymentSuccess=false', r.paymentSuccess === false, JSON.stringify(r));

  console.log('\n[6b] a 5xx is retried and then surfaces as an error');
  const flaky = stubGoogle({ purchaseStatus: 500 });
  let err = null;
  try {
    await googlePlay.checkPurchase(TOKEN, PRODUCT, { fetchImpl: flaky });
  } catch (e) {
    err = e;
  }
  ok('a persistent 5xx throws rather than reporting a paid purchase', err?.code === 'ServerError', err?.code);
  ok('it was retried', flaky.calls.filter((c) => c === `GET ${PURCHASE_URL}`).length === 3, String(flaky.calls.filter((c) => c === `GET ${PURCHASE_URL}`).length));

  // ---------------------------------------------------------------
  console.log('\n[7] missing arguments are a client error');
  err = null;
  try {
    await googlePlay.checkPurchase('', PRODUCT, { fetchImpl: stubGoogle() });
  } catch (e) {
    err = e;
  }
  ok('an empty token is MissingArgument', err?.code === 'MissingArgument', err?.code);

  // ---------------------------------------------------------------
  console.log('\n[8] processTransaction maps the internal order id');
  const txn = await googlePlay.processTransaction(TOKEN, PRODUCT, { fetchImpl: stubGoogle({ purchase: goodPurchase }) });
  ok('orderId comes from obfuscatedExternalAccountId', txn.orderId === 42, JSON.stringify({ orderId: txn.orderId }));
  ok('googleOrderId is the Play order id', txn.googleOrderId === 'GPA.1234-5678-9012-34567', txn.googleOrderId);
  ok('it was consumed', txn.consumed === true);

  const cancelled = await googlePlay.processTransaction(TOKEN, PRODUCT, {
    fetchImpl: stubGoogle({ purchase: { ...goodPurchase, purchaseState: 1 } }),
  });
  ok('a cancelled transaction is flagged, not consumed', cancelled.cancelled === true && cancelled.consumed === undefined, JSON.stringify(cancelled));

  const noOrderId = await googlePlay.processTransaction(TOKEN, PRODUCT, {
    fetchImpl: stubGoogle({ purchase: { ...goodPurchase, obfuscatedExternalAccountId: undefined } }),
  });
  ok('a missing internal order id is not consumed', noOrderId.orderId === null && noOrderId.consumed === undefined, JSON.stringify(noOrderId));

  // ---------------------------------------------------------------
  console.log('\n[9] a failed consume does not report a paid purchase');
  r = await googlePlay.checkPurchase(TOKEN, PRODUCT, {
    fetchImpl: stubGoogle({ purchase: goodPurchase, consumeOk: false }),
  });
  ok('paymentSuccess is false when consume fails', r.paymentSuccess === false, JSON.stringify(r));
} finally {
  await setAllowTestCard(0).catch(() => {});
  await db.disconnect?.().catch(() => {});
}

console.log(`\n${checks - failures}/${checks} checks passed`);
console.log(failures === 0 ? 'BILLING OK' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
