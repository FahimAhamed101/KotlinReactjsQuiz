// Request-signature verification.
//
// Ported from App\Http\Middleware\VerifyRequestSignatureMiddleware.
//
// The canonical string is:
//
//   "{METHOD}|{path}|{X-Timestamp}|{X-Nonce}|{json_body}"
//
// where `path` is the request path *without* the query string (Laravel's
// `$request->path()`), and the body is the decoded JSON re-encoded with sorted
// keys and unescaped slashes/unicode — so key order in the wire payload must not
// affect the signature.
//
// The HMAC secret is APP_KEY (Laravel's base64:... key is decoded first).
// Replays are blocked with a nonce cache; timestamps must be within +/- 60s.

import crypto from 'crypto';
import { err } from './errors';

const MAX_SKEW_MS = 60_000;
const NONCE_TTL_MS = 5 * 60_000;

// Process-local replay cache. A multi-instance deployment needs Redis here —
// same caveat as the Laravel original, which used the cache store.
const seenNonces = new Map();

function pruneNonces(now) {
  for (const [nonce, at] of seenNonces) {
    if (now - at > NONCE_TTL_MS) seenNonces.delete(nonce);
  }
}

/** Laravel APP_KEY may be `base64:...`; decode it to the raw bytes. */
function appKeyBytes() {
  const raw = process.env.APP_KEY || '';
  if (raw.startsWith('base64:')) {
    try {
      return Buffer.from(raw.slice(7), 'base64');
    } catch {
      return Buffer.from(raw, 'utf8');
    }
  }
  return Buffer.from(raw, 'utf8');
}

/** Deterministic JSON: keys sorted, slashes and unicode left unescaped. */
export function canonicalJson(value) {
  const normalise = (v) => {
    if (Array.isArray(v)) return v.map(normalise);
    if (v && typeof v === 'object') {
      const out = {};
      for (const key of Object.keys(v).sort()) out[key] = normalise(v[key]);
      return out;
    }
    return v;
  };
  return JSON.stringify(normalise(value ?? {})).replace(/\\\//g, '/');
}

export function canonicalString({ method, path, timestamp, nonce, body }) {
  return `${method}|${path}|${timestamp}|${nonce}|${body}`;
}

export function sign({ method, path, timestamp, nonce, body, key }) {
  const secret = key ?? appKeyBytes();
  return crypto
    .createHmac('sha256', secret)
    .update(canonicalString({ method, path, timestamp, nonce, body }))
    .digest('hex');
}

/**
 * Verify the signature headers on a request.
 * @param {Request} request
 * @param {any} parsedBody  the already-parsed JSON body (or {} for GET)
 */
export function verifySignature(request, parsedBody = {}) {
  // The kill-switch lets the Android client run against a local dev server
  // without implementing the signing interceptor.
  if (process.env.SIGNATURE_ENFORCED === 'false') return true;

  const signature = request.headers.get('x-signature');
  const timestamp = request.headers.get('x-timestamp');
  const nonce = request.headers.get('x-nonce');

  if (!signature || !timestamp || !nonce) {
    throw err.invalidSignature('Missing signature headers.');
  }

  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) throw err.invalidSignature('Invalid signature timestamp.');

  const now = Date.now();
  const skew = ts > 1e12 ? ts - now : ts * 1000 - now;
  if (Math.abs(skew) > MAX_SKEW_MS) {
    throw err.requestExpired('Request expired.');
  }

  pruneNonces(now);
  if (seenNonces.has(nonce)) throw err.duplicateRequest('Duplicate request.');
  seenNonces.set(nonce, now);

  const path = new URL(request.url).pathname.replace(/^\/+/, '');
  const expected = sign({
    method: request.method,
    path,
    timestamp,
    nonce,
    body: canonicalJson(parsedBody),
  });

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw err.invalidSignature('Invalid signature.');
  }

  return true;
}

/** HashMiddleware: header `hash` must equal sha256(HASH_VALUE). */
export function verifyHash(request) {
  const expected = process.env.HASH_VALUE;
  if (!expected) return true; // unconfigured => disabled, as in a bare local env

  const provided = request.headers.get('hash');
  const digest = crypto.createHash('sha256').update(expected).digest('hex');
  if (!provided || provided !== digest) {
    throw err.wrongHash('Wrong hash.');
  }
  return true;
}

/** Test helper: sign a request the way the Android SigningInterceptor does. */
export function buildSignatureHeaders({ method, path, body, key }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(8).toString('hex');
  const signature = sign({
    method,
    path,
    timestamp,
    nonce,
    body: canonicalJson(body),
    key,
  });
  return { 'X-Signature': signature, 'X-Timestamp': timestamp, 'X-Nonce': nonce };
}
