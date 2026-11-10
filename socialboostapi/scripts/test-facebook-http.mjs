// End-to-end HTTP probe for the Facebook flow against a running SocialBoost API.
//
//   node --import ./scripts/register-esm-hook.mjs scripts/test-facebook-http.mjs [baseUrl] [page]
//
// Exercises the real signed HTTP routes the Android app calls:
//   GET  /api/v6/lookup/facebook/<slug>
//   GET  /api/v6/avatar/facebook/<slug>
//   POST /api/v6/register  (platform=facebook)
//   POST /api/v6/login     (platform=facebook)
//   GET  /api/v6/me?platform=facebook
//
// The login id mirrors what `MainActivity.completeSignIn()` builds for a non-TikTok
// network — `<handle>@<platform>.ttboost.app` — so this test and the app cannot drift
// apart on the account-namespacing rule.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
require('./load-env.cjs').loadEnv(join(here, '..', '.env'));

const { buildSignatureHeaders } = await import('../lib/signature.js');

const base = (process.argv[2] || 'http://127.0.0.1:4100').replace(/\/$/, '');
const page = (process.argv[3] || 'facebook').replace(/^@/, '').toLowerCase();
const loginId = `${page}@facebook.ttboost.app`;

let fail = 0;
function expect(label, ok, detail = '') {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
}

function signed(method, path, body, extra = {}) {
  // The server signs the PATHNAME only (`new URL(request.url).pathname`), so the query
  // string must be stripped before signing — exactly what RequestSigner.kt does with
  // `path.substringBefore('?')`.
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

console.log(`\n=== Facebook HTTP flow: ${base}  page=${page} ===\n`);

// --- 0. Warm the database connection ------------------------------------------
// The Atlas SRV lookup fails on this machine and the driver falls back to the explicit
// seed list, which can take 30-60s on a cold start. The first real request otherwise
// times out mid-connect and reports a misleading "IP not whitelisted" error.
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
  const path = `/api/v6/lookup/facebook/${encodeURIComponent(page)}`;
  const { res, text, json } = await get(path);
  console.log(`GET ${path} -> ${res.status}`);
  console.log(text.slice(0, 900));
  console.log('');
  expect('lookup returns 200', res.status === 200, String(res.status));
  expect('lookup success=true', json?.success === true, String(json?.error_code || ''));
  const info = json?.data?.tiktok_info;
  expect('lookup carries tiktok_info', !!info);
  expect('lookup platform=facebook', info?.platform === 'facebook', String(info?.platform));
  expect('lookup nickname present', !!info?.nickname, String(info?.nickname));
  expect('lookup followerCount > 0', (info?.followerCount ?? 0) > 0, String(info?.followerCount));
  expect('lookup avatar_url is usable',
    typeof info?.avatar_url === 'string' &&
      (/\/avatar\/facebook\//.test(info.avatar_url) || /^https?:\/\//.test(info.avatar_url)),
    String(info?.avatar_url).slice(0, 80));
  console.log('');
}

// --- 2. Register with platform=facebook --------------------------------------
const hash = (await import('node:crypto'))
  .createHash('sha256').update(process.env.HASH_VALUE || '').digest('hex');

{
  const path = '/api/v6/register';
  const { res, text, json } = await post(path, {
    device_name: 'probe',
    id: loginId,
    username: page,
    platform: 'facebook',
    is_emulator: false,
  }, { hash });

  console.log(`POST ${path} (platform=facebook) -> ${res.status}`);
  console.log(text.slice(0, 900));
  console.log('');
  const already = [
    'UserAlreadyExists',
    'AlreadyRegistered',
    'UserAlreadyRegistered',
  ].includes(json?.error_code);
  expect('register returns 200 (or already-registered)', res.status === 200 || already,
    String(json?.error_code || res.status));
  if (res.status === 200) {
    expect('register returns a token', !!json?.data?.auth?.token);
    expect('register stamps platform=facebook',
      (json?.data?.platform === 'facebook') || (json?.data?.tiktok_info?.platform === 'facebook'),
      String(json?.data?.platform ?? json?.data?.tiktok_info?.platform));
  }
  console.log('');
}

// --- 3. Login with platform=facebook -----------------------------------------
let token = null;
{
  const path = '/api/v6/login';
  const { res, text, json } = await post(path, {
    device_name: 'probe',
    id: loginId,
    username: page,
    platform: 'facebook',
  }, { hash });

  console.log(`POST ${path} (platform=facebook) -> ${res.status}`);
  console.log(text.slice(0, 900));
  console.log('');
  expect('login returns 200', res.status === 200, String(res.status));
  expect('login success=true', json?.success === true, String(json?.error_code || ''));
  const data = json?.data;
  token = data?.auth?.token ?? null;
  expect('login returns a token', !!token);
  expect('login echoes platform=facebook',
    (data?.platform === 'facebook') || (data?.tiktok_info?.platform === 'facebook'),
    String(data?.platform ?? data?.tiktok_info?.platform));
  expect('login carries tiktok_info', !!data?.tiktok_info);
  expect('login tiktok_info nickname present', !!data?.tiktok_info?.nickname,
    String(data?.tiktok_info?.nickname));
  expect('login tiktok_info followerCount > 0', (data?.tiktok_info?.followerCount ?? 0) > 0,
    String(data?.tiktok_info?.followerCount));
  console.log('');
}

// --- 4. /me with platform=facebook -------------------------------------------
if (!token) {
  console.log('(skipping /me — no token from login)\n');
} else {
  const mePath = `/api/v6/me?username=${encodeURIComponent(page)}&platform=facebook`;
  const { res, text, json } = await get(mePath, { Authorization: `Bearer ${token}` });
  console.log(`GET ${mePath} -> ${res.status}`);
  console.log(text.slice(0, 700));
  console.log('');
  expect('/me returns 200', res.status === 200, String(res.status));
  expect('/me platform=facebook', json?.data?.tiktok_info?.platform === 'facebook',
    String(json?.data?.tiktok_info?.platform));
  expect('/me nickname present', !!json?.data?.tiktok_info?.nickname,
    String(json?.data?.tiktok_info?.nickname));
  console.log('');
}

// --- 5. Avatar mirror ---------------------------------------------------------
{
  const path = `/api/v6/avatar/facebook/${encodeURIComponent(page)}`;
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
    expect('redirect target is a facebook CDN url',
      /fbcdn\.net/.test(loc || ''), String(loc));
  }
  console.log('');
}

console.log(`${fail === 0 ? 'ALL PASS' : fail + ' FAILURES'}\n`);
process.exit(fail ? 1 : 0);