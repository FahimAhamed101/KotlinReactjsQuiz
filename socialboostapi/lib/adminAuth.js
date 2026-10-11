// Admin panel authentication.
//
// Deliberately SEPARATE from the mobile auth in lib/auth.js:
//
//   * the mobile client's login verifies no password at all (upstream Laravel did
//     `Hash::make($id)`, so the password simply equals the identifier). That is fine
//     for a throwaway app session but would be a wide-open door on an admin panel.
//   * the panel therefore has its own credential column, `User.adminPasswordHash`,
//     checked with bcrypt, and its own session mechanism: a signed JWT in an
//     httpOnly cookie rather than a bearer token the client stores.
//
// Keeping them apart means tightening one can never loosen the other, and neither
// token type is accepted by the other's routes.

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

import { ApiException } from './errors';
import { db } from './db';

export const ADMIN_COOKIE = 'ttboost_admin';
const TTL_SECONDS = 12 * 60 * 60;

function secretKey() {
  const raw = process.env.ADMIN_JWT_SECRET;
  // Fail loud. A default secret would mean anyone who reads the source can mint an
  // admin session, which is worse than the panel being briefly unavailable.
  if (!raw) throw new Error('ADMIN_JWT_SECRET is not set — refusing to issue admin sessions.');
  return new TextEncoder().encode(raw);
}

/** @returns {Promise<string>} a signed JWT for the given admin user */
export async function signAdminToken(user) {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secretKey());
}

/** @returns {Promise<{id:number,email:string}|null>} the payload, or null when invalid */
export async function verifyAdminToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey());
    const id = Number(payload.sub);
    if (!Number.isFinite(id)) return null;
    return { id, email: payload.email };
  } catch {
    // Expired, tampered with, or signed with a different secret — all "not logged in".
    return null;
  }
}

/**
 * Check an email/password pair against the admin credential column.
 * @returns {Promise<object|null>} the user, or null when the credentials are wrong
 */
export async function authenticateAdmin(email, password) {
  // `adminPasswordHash` is `select: false`, so it must be asked for explicitly —
  // an ordinary query never carries the hash around.
  const user = await db.user.findOne({
    where: { email },
    select: { id: true, email: true, name: true, isAdmin: true, adminPasswordHash: true },
  });

  if (!user?.adminPasswordHash) return null;
  if (!user.isAdmin) return null;

  const ok = await bcrypt.compare(String(password), user.adminPasswordHash);
  if (!ok) return null;

  const { adminPasswordHash, ...safe } = user;
  return safe;
}

/** Resolve the admin session from a Request (route handlers). */
export async function adminFromRequest(request) {
  const token = request?.cookies?.get?.(ADMIN_COOKIE)?.value ?? null;
  return verifyAdminToken(token);
}

/**
 * Guard an admin API route.
 *
 * Every admin route calls this. Gating only the UI would leave the endpoints open to
 * anyone who can guess a path — hiding a link is not access control.
 */
export async function requireAdmin(request) {
  const admin = await adminFromRequest(request);
  if (!admin) throw new ApiException('Unauthorized', 'Admin sign-in required.', 401);

  // Re-read the row so revoking isAdmin takes effect immediately rather than at
  // token expiry.
  const user = await db.user.findOne({
    where: { id: admin.id },
    select: { id: true, email: true, name: true, isAdmin: true, status: true },
  });
  if (!user?.isAdmin) throw new ApiException('Unauthorized', 'Admin sign-in required.', 401);

  return user;
}

/**
 * Resolve the admin session inside a Server Component (the panel layout guard).
 * Returns null instead of throwing so the layout can redirect cleanly.
 */
export async function currentAdmin() {
  const token = cookies().get(ADMIN_COOKIE)?.value ?? null;
  const payload = await verifyAdminToken(token);
  if (!payload) return null;

  const user = await db.user.findOne({
    where: { id: payload.id },
    select: { id: true, email: true, name: true, isAdmin: true, status: true },
  });
  return user?.isAdmin ? user : null;
}

/** Cookie options shared by login and logout so they cannot drift apart. */
export function adminCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TTL_SECONDS,
  };
}
