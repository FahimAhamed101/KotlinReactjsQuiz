// POST /api/admin/login
//
// Panel sign-in. Separate from the mobile login on purpose — see lib/adminAuth.js.

import { handle, success } from '@/lib/envelope';
import { ApiException } from '@/lib/errors';
import { readJson, requireString } from '@/lib/validate';
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  authenticateAdmin,
  signAdminToken,
} from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

// Process-local throttle. The Laravel original limits `loginRateLimit` per minute; an
// admin password is the single most valuable credential in the system, so some brake is
// worth having. A multi-instance deployment needs this in Redis — same caveat as the
// welcome-bonus slot counter.
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;
const attempts = new Map();

function throttle(key) {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  attempts.set(key, recent);

  // Keep the map from growing without bound in a long-lived process.
  if (attempts.size > 500) {
    for (const [k, v] of attempts) {
      if (v.every((t) => now - t >= WINDOW_MS)) attempts.delete(k);
    }
  }

  if (recent.length > MAX_ATTEMPTS) {
    throw new ApiException('RateLimitExceeded', 'Too many sign-in attempts. Please wait a minute.', 429);
  }
}

export const POST = handle(async (request) => {
  const body = await readJson(request);

  const email = requireString(body, 'email', { max: 255 }).trim().toLowerCase();
  const password = requireString(body, 'password', { max: 200 });

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  throttle(`${ip}|${email}`);

  const admin = await authenticateAdmin(email, password);
  if (!admin) {
    // Identical message for "no such admin" and "wrong password", so the endpoint
    // cannot be used to enumerate which accounts are admins.
    throw new ApiException('Unauthorized', 'Incorrect email or password.', 401);
  }

  attempts.delete(`${ip}|${email}`);

  const token = await signAdminToken(admin);
  const response = success({ admin });
  response.cookies.set(ADMIN_COOKIE, token, adminCookieOptions());
  return response;
});
