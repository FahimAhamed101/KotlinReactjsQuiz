// Google Play receipt verification.
//
// Ported from App\Services\GooglePlayService. This is the only place that is allowed to
// say "the customer paid", so the rules it enforces are the ones that stop free coins:
//
//   * a purchase that Play reports as cancelled (purchaseState 1) is refused
//   * an already-consumed token is refused, so a receipt cannot be replayed
//   * a test card is refused unless the `allowTestCard` setting opts in
//   * the token is consumed only after those checks pass, so a retry can re-verify it
//
// There is deliberately NO simulated-success path. If the service account is not
// configured, every entry point throws. A previous iteration of this project shipped a
// mock fallback that minted a fake `GPA.xxxx` order id and made the app report
// "Purchase Verified" while charging nothing — see the note in lib/services/coinsCheck.js.
//
// Auth uses the OAuth2 JWT-bearer flow signed with the service account's private key.
// `jose` is already a dependency, which keeps `googleapis` (and its ~90 MB tree) out.

import { SignJWT, importPKCS8 } from 'jose';
import { readFileSync } from 'node:fs';
import { getInt } from '../settings';
import { ApiException } from '../errors';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const PUBLISHER = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

export const DEFAULT_PACKAGE_NAME = 'com.Fahim101.tomquiz';

/** How many times a *transient* failure is retried before giving up. */
const MAX_ATTEMPTS = 3;

let credentialsCache = null;
let tokenCache = null; // { value, expiresAt }

/**
 * Load the service account, or return null when none is configured.
 *
 * Accepts either inline JSON (raw or base64, the usual way to pass it through a hosting
 * dashboard) or a path to a key file.
 */
function loadCredentials() {
  if (credentialsCache !== null) return credentialsCache;

  const inline = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
  if (inline) {
    const raw = inline.trim().startsWith('{')
      ? inline
      : Buffer.from(inline, 'base64').toString('utf8');
    try {
      credentialsCache = JSON.parse(raw);
      return credentialsCache;
    } catch {
      throw new ApiException(
        'ServerError',
        'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is set but is not valid JSON.',
        503,
      );
    }
  }

  const path =
    process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE;
  if (path) {
    try {
      credentialsCache = JSON.parse(readFileSync(path, 'utf8'));
      return credentialsCache;
    } catch {
      throw new ApiException(
        'ServerError',
        `Google Play service account file could not be read: ${path}`,
        503,
      );
    }
  }

  credentialsCache = false;
  return null;
}

/** True when a usable service account is configured. */
export function hasCredentials() {
  return !!loadCredentials();
}

export function packageName() {
  return process.env.PLAY_PACKAGE_NAME || DEFAULT_PACKAGE_NAME;
}

/**
 * Describe the billing configuration for diagnostics.
 *
 * Callers use this to fail loudly at boot rather than at the first purchase, which is
 * where a missing key is most expensive.
 */
export function billingStatus() {
  const creds = loadCredentials();
  if (!creds) {
    return {
      configured: false,
      reason:
        'No Google Play service account. Set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON (inline JSON or base64) or GOOGLE_APPLICATION_CREDENTIALS (path to the key file).',
    };
  }
  const missing = ['client_email', 'private_key'].filter((k) => !creds[k]);
  if (missing.length) {
    return {
      configured: false,
      reason: `Service account is missing: ${missing.join(', ')}`,
    };
  }
  return {
    configured: true,
    client_email: creds.client_email,
    package_name: packageName(),
  };
}

/** Exchange the service account for an access token, caching it until it expires. */
async function getAccessToken({ fetchImpl = fetch, force = false } = {}) {
  if (!force && tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.value;
  }

  const creds = loadCredentials();
  if (!creds) throw new ApiException('ServerError', billingStatus().reason, 503);

  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(creds.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(creds.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiException(
      'ServerError',
      `Google rejected the service account credentials (${res.status}): ${body.slice(0, 200)}`,
      503,
    );
  }

  const json = await res.json();
  if (!json?.access_token) {
    throw new ApiException('ServerError', 'Google returned no access_token.', 503);
  }

  tokenCache = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
  return tokenCache.value;
}

/** Test hook: forget the cached token/credentials. */
export function resetBillingCache() {
  tokenCache = null;
  credentialsCache = null;
}

function purchaseUrl(token, productId) {
  return `${PUBLISHER}/${packageName()}/purchases/products/${productId}/tokens/${token}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a purchase's state from Play.
 *
 * Retries transport errors, 429s, 5xx and a stale token (401). It does NOT retry a
 * definitive verdict — a cancelled purchase or a consumed token will read the same on
 * every attempt, and the original's blanket retry burned ~5 s per refused purchase.
 */
async function fetchPurchaseState(url, { fetchImpl = fetch } = {}) {
  let lastTransportError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      const accessToken = await getAccessToken({ fetchImpl, force: attempt > 1 });
      res = await fetchImpl(url, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      });
    } catch (e) {
      if (e instanceof ApiException) throw e; // misconfiguration — retrying will not help
      lastTransportError = e;
      if (attempt < MAX_ATTEMPTS) await sleep(attempt * 1000);
      continue;
    }

    if (res.status === 401 || res.status === 429 || res.status >= 500) {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(attempt * 1000);
        continue;
      }
      throw new ApiException(
        'ServerError',
        `Google Play returned ${res.status} after ${MAX_ATTEMPTS} attempts.`,
        503,
      );
    }

    if (res.status === 404) {
      // Unknown token or product id. Definitive, and the caller maps it to a refusal.
      return { notFound: true };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new ApiException('ServerError', `Google Play returned ${res.status}: ${body.slice(0, 200)}`, 503);
    }

    return { data: await res.json() };
  }

  throw new ApiException(
    'ServerError',
    `Could not reach Google Play: ${lastTransportError?.message ?? 'unknown error'}`,
    503,
  );
}

/**
 * Verify a one-time purchase and consume it.
 *
 * Mirrors GooglePlayService::checkPurchase, including its return shape: the caller reads
 * `paymentSuccess`. A refusal is returned, not thrown, so the route can emit the same
 * `Unknown` error code the Android client already handles.
 *
 * @returns {Promise<{paymentSuccess: boolean, [k: string]: any}>}
 */
export async function checkPurchase(token, productId, { fetchImpl = fetch } = {}) {
  if (!token || !productId) {
    throw new ApiException('MissingArgument', 'purchase_token and a product id are required.');
  }

  const url = purchaseUrl(token, productId);
  const refuse = (reason) => {
    // Kept for the server log only — the wire response stays `Unknown`, as before.
    console.warn(`[billing] purchase refused: ${reason} (product=${productId})`);
    return { paymentSuccess: false, failureReason: reason };
  };

  let result;
  try {
    result = await fetchPurchaseState(url, { fetchImpl });
  } catch (e) {
    if (e instanceof ApiException) throw e;
    return refuse(e.message);
  }

  if (result.notFound) return refuse('Play does not know this token for this product');
  const data = result.data ?? {};

  if (!('purchaseState' in data) || data.purchaseState === 1) {
    return refuse('cancelled or pending');
  }

  const allowTestCard = await getInt('allowTestCard');
  if (allowTestCard <= 0 && data.purchaseType === 0) {
    return refuse('test purchase while allowTestCard is off');
  }

  if (data.consumptionState === 1) {
    return refuse('token already consumed');
  }

  // Consume only after every check passed, so a failed request can be retried by the
  // client without having burned the token.
  try {
    await consume(url, { fetchImpl });
  } catch (e) {
    return refuse(`consume failed: ${e.message}`);
  }

  return { ...data, paymentSuccess: true };
}

/** Consume a purchase so it can be bought again. Throws on failure. */
async function consume(url, { fetchImpl = fetch } = {}) {
  const accessToken = await getAccessToken({ fetchImpl });
  const res = await fetchImpl(`${url}:consume`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiException('ServerError', `consume failed (${res.status}): ${body.slice(0, 200)}`, 503);
  }
}

/**
 * Verify a purchase made for an *order* (not a coin pack).
 *
 * Returns a verdict rather than throwing, because the caller stores it on the order and
 * decides what to do: `cancelled`, `alreadyConsumed`, `testCard` and a missing internal
 * order id are all legitimate outcomes to record.
 *
 * `obfuscatedExternalAccountId` carries the internal order id the client passed to Play.
 */
export async function processTransaction(token, productId, { fetchImpl = fetch, expectedOrderId = null } = {}) {
  if (!token || !productId) {
    throw new ApiException('MissingArgument', 'purchase_token and a product id are required.');
  }

  const url = purchaseUrl(token, productId);
  const result = await fetchPurchaseState(url, { fetchImpl });
  if (result.notFound) return { cancelled: true, notFound: true };

  const response = result.data ?? {};
  const allowTestCard = await getInt('allowTestCard');

  const data = {
    orderId: response.obfuscatedExternalAccountId
      ? Number(response.obfuscatedExternalAccountId)
      : (expectedOrderId ? Number(expectedOrderId) : null),
    googleOrderId: response.orderId ?? null,
    verifyTransactionResponse: response,
  };

  if (response.purchaseType === 0) data.testCard = true;

  if (!('purchaseState' in response) || response.purchaseState === 1) {
    data.cancelled = true;
    return data;
  }
  if (response.consumptionState === 1) {
    data.alreadyConsumed = true;
    return data;
  }
  if (allowTestCard <= 0 && data.testCard) {
    console.info(`[billing] test card not allowed for token ${token.slice(0, 12)}…`);
    return data;
  }

  if (!data.orderId) {
    // Without the internal order id there is nothing to attach the payment to, and Play
    // cannot be told to consume it. Recorded rather than silently dropped.
    console.info('[billing] no obfuscatedExternalAccountId, cannot consume');
    return data;
  }

  try {
    await consume(url, { fetchImpl });
    data.consumed = true;
  } catch (e) {
    console.warn(`[billing] consume failed: ${e.message}`);
    data.consumed = false;
  }

  return data;
}

/** Refunded/voided purchases since a timestamp. Used by the reconciliation job. */
export async function getVoidedPurchases(startTime, { fetchImpl = fetch } = {}) {
  const accessToken = await getAccessToken({ fetchImpl });
  const url = `${PUBLISHER}/${packageName()}/purchases/voidedpurchases?startTime=${encodeURIComponent(startTime)}`;
  const res = await fetchImpl(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json.voidedPurchases ?? null;
}

export { purchaseUrl };
