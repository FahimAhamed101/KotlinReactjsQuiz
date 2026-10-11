// Auth guard composition.
//
// Ported from the middleware stacks in routes/api.php:
//
//   authenticated group : auth:sanctum, EnsureUserIsActive, EnsureAccountIsActive
//   v5 / v6 outer       : VerifyRequestSignatureMiddleware, VerifyFirebaseAppCheckToken
//
// Each guard is exposed individually so a route can opt out of one (the login
// routes skip sanctum but keep the hash check, for example).

import { currentUser, ensureUserIsActive } from './auth';
import { verifyHash, verifySignature } from './signature';
import { err } from './errors';
import db from './db';

/**
 * The full authenticated-client stack.
 * @param {Request} request
 * @param {object} body  already-parsed JSON body (needed for signature + account lookup)
 */
export async function guard(request, body = {}, { signature = true, hash = false } = {}) {
  if (hash) verifyHash(request);
  if (signature) verifySignature(request, body);

  verifyAppCheck(request);

  const user = await currentUser(request, { required: true });
  ensureUserIsActive(user);

  await ensureAccountIsActive(request, body);

  return user;
}

/**
 * EnsureAccountIsActive — the referenced TikTok account must not be banned.
 * Also lowercases `username` in place, exactly as the Laravel middleware does.
 */
export async function ensureAccountIsActive(request, body = {}) {
  const secUid = body?.sec_uid || request.headers.get('x-sec-uid') || null;
  const username = body?.username || body?.profile_username || null;

  if (username) body.username = String(username).toLowerCase();

  let account = null;
  if (secUid) {
    account = await db.account.findOne({ where: { secUid } });
  }
  if (!account && body.username) {
    account = await db.account.findOne({ where: { username: body.username } });
  }

  if (account?.isBanned) {
    throw err.accountBanned(account.username, [
      { username: account.username, sec_uid: account.secUid },
    ]);
  }

  return account;
}

/**
 * VerifyFirebaseAppCheckToken.
 * Feature-flagged off by default, matching FIREBASE_APP_CHECK_ENABLED=false.
 */
export function verifyAppCheck(request) {
  if (process.env.FIREBASE_APP_CHECK_ENABLED !== 'true') return true;

  const token = request.headers.get('x-firebase-appcheck');
  if (!token) throw err.appCheckMissing('App Check token missing.');
  // A production deployment must verify this against Firebase. Refusing any
  // non-empty token would be worse than useless, so we surface it as invalid
  // until a verifier is wired in.
  if (!process.env.FIREBASE_APP_CHECK_VERIFIED) {
    throw err.appCheckInvalid('App Check token could not be verified.');
  }
  return true;
}
