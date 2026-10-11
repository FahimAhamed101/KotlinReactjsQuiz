// Auth: token issuance + verification.
//
// Ported from Laravel Sanctum usage in AuthService / v6\AuthService.
//
// Key behaviours preserved:
//   * Every successful login REVOKES all previous tokens (single active session).
//   * Tokens are `"{id}|{random}"` and expire after `tokenExpiresIn` minutes.
//   * An expired token yields `TokenExpired` 401, not a generic Unauthorized.
//   * The login identifier is the user's email column, and the password equals it
//     (`Hash::make($id)`) — there is no real password entry in this app.

import crypto from 'crypto';
import db from './db';
import { getInt } from './settings';
import { err, ApiException } from './errors';

const TOKEN_RE = /^(\d+)\|([A-Za-z0-9]+)$/;

/** sha256 of the plaintext token — we never store the raw value. */
function hashToken(plain) {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

/**
 * Issue a token for a user, revoking every existing one first.
 * @returns {Promise<{token: string, expires_at: string|null}>}
 */
export async function issueToken(userId, deviceName = 'android') {
  await db.personalAccessToken.deleteMany({ where: { userId } });

  const random = crypto.randomBytes(20).toString('hex');
  const plain = `${userId}|${random}`;
  const ttlMinutes = await getInt('tokenExpiresIn', 43200);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  await db.personalAccessToken.create({
    data: {
      userId,
      name: deviceName || 'android',
      token: hashToken(plain),
      expiresAt,
    },
  });

  // UTC ISO8601 with a literal Z, matching the v6 contract.
  const expiresIso = expiresAt.toISOString().replace(/\.\d{3}Z$/, 'Z');

  return { token: plain, expires_at: expiresIso };
}

/**
 * Resolve the bearer token to a user.
 * @param {Request} request
 * @param {{required?: boolean}} opts
 */
export async function currentUser(request, { required = true } = {}) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());

  if (!match) {
    if (required) throw err.unauthorized('Unauthenticated.');
    return null;
  }

  const plain = match[1];
  const row = await db.personalAccessToken.findOne({
    where: { token: hashToken(plain) },
    include: { user: true },
  });

  if (!row || !row.user) {
    if (required) throw err.unauthorized('Unauthenticated.');
    return null;
  }

  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    throw new ApiException('TokenExpired', 'Your token has expired.', 401);
  }

  // Best-effort last-used stamp; never fail the request over it.
  db.personalAccessToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return row.user;
}

/** EnsureUserIsActive: the user must exist and not be Suspended. */
export function ensureUserIsActive(user) {
  if (!user) throw err.unauthorized('Unauthenticated.');
  if (user.status !== 'Active') {
    throw err.suspended(String(user.id), [{ user_id: user.id }]);
  }
  return user;
}

/** Shape returned as `user` in auth responses (UserResource). */
export function userResource(user) {
  return {
    coins: user.coins,
    id: user.id,
    created_at: user.createdAt,
  };
}

export { TOKEN_RE };
