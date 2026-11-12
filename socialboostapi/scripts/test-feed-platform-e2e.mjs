// End-to-end: the task feed must respect the viewer's platform, through the real route.
//
// The DB-level test (test-feed-platform-scope.mjs) pins getFeed(). This one proves the
// ROUTE wires it up: the `platform` query parameter the Android client sends must reach
// the feed query, and the rows that come back must all be on that network.
//
// Why it matters (Request C): a follow/like is verified by comparing the viewer's own
// counter on the task's network, so a task from another network can never be completed
// and never pays. Serving Instagram work to a TikTok-only viewer is exactly how "I
// followed and got no coins" happens.
//
// Uses a throwaway probe account on purpose — never `fahim1000011`, whose login would
// invalidate the phone session's tokens.
//
// Needs the dev server on :4000 —
//   node --import ./scripts/register-esm-hook.mjs scripts/test-feed-platform-e2e.mjs

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
require('./load-env.cjs').loadEnv(join(here, '..', '.env'));

const { buildSignatureHeaders } = await import('../lib/signature.js');

const BASE = 'http://127.0.0.1:4000';
const hash = createHash('sha256').update(process.env.HASH_VALUE || '').digest('hex');

let pass = 0;
let fail = 0;
function expect(label, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

function signed(method, path, body = {}, extra = {}) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...extra,
    ...buildSignatureHeaders({
      method,
      // Pathname only — the server strips the query before signing.
      path: path.split('?')[0].replace(/^\/+/, ''),
      body,
    }),
  };
}

async function req(method, path, body, extra = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: signed(method, path, body, extra),
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json, text };
}

// --- a throwaway probe identity ------------------------------------------------
//
// NOT the `facebook@…` probe: that account (u#64) happens to OWN every Facebook and
// Instagram order in the database, so the feed correctly excludes them all and every
// network would come back empty — a false alarm that says nothing about platform
// scoping. This probe owns no Facebook/Instagram orders, so those networks still have
// work to offer and the non-emptiness assertion is meaningful.
//
// Never `fahim1000011`: logging in clears that user's tokens and kills the phone session.
console.log('\n=== login (probe) ===');
const login = await req('POST', '/api/v6/login', {
  device_name: 'feed-platform-scope-probe',
  id: 'demo@ttboost.app',
  username: 'demo',
  platform: 'tiktok',
}, { hash });

console.log(`  login: ${login.status} ${login.json?.error_code ?? ''}`);
const token = login.json?.data?.auth?.token;
if (!token) {
  console.error('  cannot continue without a token');
  process.exit(1);
}

/**
 * Fetch the feed as this viewer, on a chosen network.
 *
 * The username must be the PROBE's, not a hard-coded one: the route resolves the viewer
 * from it, and sending `username=facebook` made the server identify the viewer as the
 * @facebook account itself — whose own Facebook orders are then correctly excluded as
 * self-dealing, so the Facebook feed came back empty and looked like a scoping bug.
 */
async function feed(platform) {
  const path = `/api/v6/orders?platform=${platform}&username=demo&page=1`;
  const res = await req('GET', path, undefined, { Authorization: `Bearer ${token}` });
  const items = Array.isArray(res.json?.data?.items) ? res.json.data.items : [];
  return { res, items };
}

// --- the assertion, per network ------------------------------------------------
for (const platform of ['facebook', 'tiktok', 'instagram']) {
  const { res, items } = await feed(platform);
  const wrong = items.filter((o) => (o.platform ?? 'tiktok') !== platform);

  console.log(`\n=== feed(platform=${platform}): HTTP ${res.status}, ${items.length} item(s) ===`);
  for (const o of items) {
    console.log(`    #${o.id} plat=${o.platform} ${o.is_likes ? 'like  ' : 'follow'} @${o.username}`);
  }

  expect(`feed(${platform}) returned 200`, res.status === 200, `HTTP ${res.status}`);
  expect(
    `feed(${platform}) served nothing from another network`,
    wrong.length === 0,
    wrong.map((o) => `#${o.id}:${o.platform}`).join(', ') || 'none wrong',
  );
  expect(`feed(${platform}) is not empty`, items.length > 0, String(items.length));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`}  pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
