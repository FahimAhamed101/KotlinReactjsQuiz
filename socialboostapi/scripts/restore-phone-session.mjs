// Restore the connected phone's session after a dev script evicted it.
//
// WHY THIS EXISTS
// ---------------
// `lib/auth.js::issueToken()` revokes every existing token for a user on each
// successful login — that is deliberate Laravel Sanctum parity (single active
// session) and must stay. But it means that any *script* which logs in as the
// phone's own user (`fahim1000011`) silently logs the phone out: the next request
// from the handset gets `Unauthenticated`, the Tasks tab renders
// "Could not load tasks. Pull to retry.", and nothing in the app explains why.
//
// This utility puts the handset back exactly where it was — without performing a
// login. That matters: a fresh login against the deployed Vercel build re-fetches
// the TikTok profile, and Vercel has no RAPID_API_KEY, so a real avatar would be
// overwritten with the stub placeholder. Restoring the existing token avoids that.
//
// Token format is `"{userId}|{random}"` (see lib/auth.js) — the numeric half is the
// USER id, not the token row id. So this rewrites the user's single session row to
// hold sha256(phone token), preserving the one-active-session invariant.
//
// USAGE
//   # token read straight off the connected device (default)
//   node --import ./scripts/register-esm-hook.mjs scripts/restore-phone-session.mjs
//
//   # or supply one explicitly
//   node --import ./scripts/register-esm-hook.mjs scripts/restore-phone-session.mjs "38|959e…"
//
// Safe to re-run.

import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');

const db = (await import('../lib/db.js')).default;
const { getInt } = await import('../lib/settings.js');

const PKG = 'com.Fahim101.tomquiz';
const PREFS = 'shared_prefs/buy_codes_quiz_prefs.xml';
const TOKEN_KEY = 'ttboost_auth_token';

/** Read the app's stored bearer token off the attached handset. */
function readTokenFromDevice() {
  const adb = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'Android',
    'Sdk',
    'platform-tools',
    process.platform === 'win32' ? 'adb.exe' : 'adb',
  );

  const xml = execFileSync(adb, ['shell', 'run-as', PKG, 'cat', PREFS], {
    encoding: 'utf8',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });

  const m = new RegExp(`name="${TOKEN_KEY}"[^>]*>([^<]+)<`).exec(xml);
  if (!m) throw new Error(`${TOKEN_KEY} not found in ${PREFS} — is the app logged in?`);
  return m[1];
}

const raw = (process.argv[2] || readTokenFromDevice()).trim();
const parsed = /^(\d+)\|([A-Za-z0-9]+)$/.exec(raw);
if (!parsed) throw new Error(`not a valid "{userId}|{random}" token: ${raw.slice(0, 12)}…`);

const userId = Number(parsed[1]);
const hash = crypto.createHash('sha256').update(raw).digest('hex');

const user = await db.user.findOne({ where: { id: userId } });
if (!user) throw new Error(`no user with id=${userId} (token prefix)`);

const existing = await db.personalAccessToken.find({ where: { userId } });
console.log(
  `phone token belongs to userId=${userId} (${user.email}); ` +
    `${existing.length} session row(s) currently held`,
);

const ttlMinutes = await getInt('tokenExpiresIn', 43200);
const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

if (existing.length > 0) {
  // Rewrite the newest row in place — keeps exactly one session for this user.
  const row = existing.reduce((a, b) => (a.id > b.id ? a : b));
  await db.personalAccessToken.update({
    where: { id: row.id },
    data: { token: hash, expiresAt, lastUsedAt: new Date() },
  });
  console.log(`rewrote session row id=${row.id} to match the handset's stored token`);
} else {
  await db.personalAccessToken.create({
    data: { userId, name: 'android', token: hash, lastUsedAt: new Date(), expiresAt },
  });
  console.log('created a fresh session row for the handset token');
}

console.log(`expires ${expiresAt.toISOString()}`);
console.log('The handset can use its existing stored token again; no re-login needed.');

process.exit(0);
