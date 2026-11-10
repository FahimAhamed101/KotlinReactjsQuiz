// End-to-end HTTP probe for the Instagram flow against a running SocialBoost API.
//
//   node --import ./scripts/register-esm-hook.mjs scripts/test-instagram-http.mjs [baseUrl] [username]
//
// Exercises the real signed HTTP routes the Android app calls:
//   GET  /api/v6/lookup/instagram/<handle>
//   GET  /api/v6/avatar/instagram/<handle>
//   POST /api/v6/login    (platform=instagram)
//   GET  /api/v6/me?platform=instagram
//
// Nothing here writes to a real user's session; a throwaway handle is used for the
// login so no existing token is invalidated.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
require('./load-env.cjs').loadEnv(join(here, '..', '.env'));

const { buildSignatureHeaders } = await import('../lib/signature.js');

const base = (process.argv[2] || 'http://127.0.0.1:4100').replace(/\/$/, '');
const handle = (process.argv[3] || 'fahim_prime3000').replace(/^@/, '').toLowerCase();

let fail = 0;
function expect(label, ok, detail = '') {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
}

function signed(method, path, body, extra = {}) {
  // The server signs the PATHNAME only — `new URL(request.url).pathname` — so the
  // query string must be stripped before signing, exactly as RequestSigner.kt does
  // with `path.substringBefore('?')`. Signing the query produced InvalidSignature
  // on every GET that carried one.
  const signedPath = path.split('?')[0].replace(/^\/+/, '');
  return {
    Accept: 'application/json',
    ...extra,
    ...buildSignatureHeaders({ method, path: signedPath, body: body ?? {} }),
  };
}

async function get(path, extra = {}) {
  const res = await fetch(base + path, { headers: signed('GET', path, {}, extra) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { res, text, json };
}

async function post(path, body, extra = {}) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: signed('POST', path, body, { 'Content-Type': 'application/json', ...extra }),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { res, text, json };
}

console.log(`\n=== Instagram HTTP flow: ${base}  handle=@${handle} ===\n`);

// --- 0. Warm the database connection ------------------------------------------
// The Atlas SRV lookup fails on this machine and the driver falls back to the
// explicit seed list, which can take 30-60s to establish on a cold start. The very
// first request otherwise times out mid-connect and reports a misleading "IP not
// whitelisted" error. One throwaway signed request pays that cost up front.
{
  const path = '/api/v6/codes';
  const started = Date.now();
  try {
    await fetch(base + path, { headers: signed('GET', path, {}) });
  } catch { /* irrelevant */ }
  console.log(`(db warmup via ${path}: ${Date.now() - started}ms)\n`);
}

// --- 1. Pre-login lookup ------------------------------------------------------
{
  const path = `/api/v6/lookup/instagram/${encodeURIComponent(handle)}`;
  const { res, text, json } = await get(path);
  console.log(`GET ${path} -> ${res.status}`);
  console.log(text.slice(0, 900));
  console.log('');
  expect('lookup returns 200', res.status === 200, String(res.status));
  expect('lookup success=true', json?.success === true);
  const info = json?.data?.tiktok_info;
  expect('lookup carries tiktok_info', !!info);
  expect('lookup platform=instagram', info?.platform === 'instagram', String(info?.platform));
  expect('lookup nickname present', !!info?.nickname, String(info?.nickname));
  expect('lookup followerCount > 0', (info?.followerCount ?? 0) > 0, String(info?.followerCount));
  expect('lookup followingCount > 0', (info?.followingCount ?? 0) > 0, String(info?.followingCount));
  // Either shape is correct: the platform-scoped mirror path once bytes are stored,
  // or the upstream CDN URL before that. The Android client builds the mirror URL
  // itself from (platform, username), so it does not depend on this field being a
  // mirror — but it must be a usable absolute URL of some kind.
  expect('lookup avatar_url is usable',
    typeof info?.avatar_url === 'string' &&
      (/\/avatar\/instagram\//.test(info.avatar_url) ||
       /cdninstagram\.com|fbcdn\.net/.test(info.avatar_url) ||
       /^https?:\/\//.test(info.avatar_url)),
    String(info?.avatar_url).slice(0, 80));
  console.log('');
}

// --- 2. Register with platform=instagram -------------------------------------
const hash = (await import('node:crypto'))
  .createHash('sha256').update(process.env.HASH_VALUE || '').digest('hex');

{
  const path = '/api/v6/register';
  const loginId = `${handle}@ttboost.app`;
  const { res, text, json } = await post(path, {
    device_name: 'probe',
    id: loginId,
    username: handle,
    platform: 'instagram',
    is_emulator: false,
  }, { hash });

  console.log(`POST ${path} (platform=instagram) -> ${res.status}`);
  console.log(text.slice(0, 900));
  console.log('');
  // Already-registered is a pass: the account exists from a previous run.
  const already = [
    'UserAlreadyExists',
    'AlreadyRegistered',
    'UserAlreadyRegistered',
  ].includes(json?.error_code);
  expect('register returns 200 (or already-registered)', res.status === 200 || already,
    String(json?.error_code || res.status));
  if (res.status === 200) {
    expect('register returns a token', !!json?.data?.auth?.token);
    expect('register stamps platform=instagram',
      (json?.data?.platform === 'instagram') || (json?.data?.tiktok_info?.platform === 'instagram'),
      String(json?.data?.platform ?? json?.data?.tiktok_info?.platform));
  }
  console.log('');
}

// --- 3. Login with platform=instagram ----------------------------------------
let token = null;
{
  const path = '/api/v6/login';
  const loginId = `${handle}@ttboost.app`;
  const { res, text, json } = await post(path, {
    device_name: 'probe',
    id: loginId,
    username: handle,
    platform: 'instagram',
  }, { hash });

  console.log(`POST ${path} (platform=instagram) -> ${res.status}`);
  console.log(text.slice(0, 900));
  console.log('');
  expect('login returns 200', res.status === 200, String(res.status));
  expect('login success=true', json?.success === true, String(json?.error_code || ''));
  const data = json?.data;
  token = data?.auth?.token ?? null;
  expect('login returns a token', !!token);
  expect('login echoes platform=instagram',
    (data?.platform === 'instagram') || (data?.tiktok_info?.platform === 'instagram'),
    String(data?.platform ?? data?.tiktok_info?.platform));
  expect('login carries tiktok_info', !!data?.tiktok_info);
  expect('login tiktok_info nickname present', !!data?.tiktok_info?.nickname,
    String(data?.tiktok_info?.nickname));
  expect('login tiktok_info followerCount > 0', (data?.tiktok_info?.followerCount ?? 0) > 0,
    String(data?.tiktok_info?.followerCount));
  console.log('');
}

// --- 4. /me with platform=instagram ------------------------------------------
if (!token) {
  console.log('(skipping /me — no token from login)\n');
} else {
  const mePath = `/api/v6/me?username=${encodeURIComponent(handle)}&platform=instagram`;
  const { res, text, json } = await get(mePath, { Authorization: `Bearer ${token}` });
  console.log(`GET ${mePath} -> ${res.status}`);
  console.log(text.slice(0, 700));
  console.log('');
  expect('/me returns 200', res.status === 200, String(res.status));
  expect('/me platform=instagram', json?.data?.tiktok_info?.platform === 'instagram',
    String(json?.data?.tiktok_info?.platform));
  expect('/me nickname present', !!json?.data?.tiktok_info?.nickname,
    String(json?.data?.tiktok_info?.nickname));
  console.log('');
}

// --- 5. Avatar mirror ---------------------------------------------------------
{
  const path = `/api/v6/avatar/instagram/${encodeURIComponent(handle)}`;
  const res = await fetch(base + path, { redirect: 'manual' });
  const ct = res.headers.get('content-type') || '';
  const buf = res.status === 200 ? Buffer.from(await res.arrayBuffer()) : Buffer.alloc(0);
  const loc = res.headers.get('location');
  console.log(`GET ${path} -> ${res.status}  type=${ct}  bytes=${buf.length}  location=${loc || '-'}`);
  console.log('');
  expect('avatar route answers 200 or 302',
    res.status === 200 || res.status === 302, String(res.status));
  if (res.status === 200) {
    expect('avatar served as an image', ct.startsWith('image/'), ct);
    expect('avatar has bytes', buf.length > 1000, String(buf.length));
  } else {
    expect('redirect target is an instagram CDN url',
      /cdninstagram\.com|fbcdn\.net/.test(loc || ''), String(loc));
  }
  console.log('');
}


console.log(`${fail === 0 ? 'ALL PASS' : fail + ' FAILURES'}\n`);
process.exit(fail ? 1 : 0);
