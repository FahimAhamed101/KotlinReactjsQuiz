// End-to-end: Shares, Comments and Views behave like Likes, each measured on its OWN counter.
//
// The risk this guards is subtle. All four actions share one baseline table and one verifier,
// so the failure mode is a task measured against the WRONG counter — a comment order paid on
// the post's like count, or a view order paid on anything at all. The assertions below pin
// the counter each action resolves to, and that an unreadable counter refuses instead of
// paying.
//
// Needs the dev server on :4000 (local .env must have a live RAPID_API_KEY for the provider
// checks; those are skipped rather than failed when it does not).
//
//   node --import ./scripts/register-esm-hook.mjs scripts/test-post-actions.mjs

import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
require('./load-env.cjs').loadEnv(join(here, '..', '.env'));

const { buildSignatureHeaders } = await import('../lib/signature.js');
const { ActionType, actionFromProductType, metricValue, metricFor, settingFor } = await import(
  '../lib/services/postActions.js'
);
const { getPostInfo } = await import('../lib/services/posts.js');
const { dbConnect } = await import('../lib/mongodb.js');
await dbConnect();
const db = (await import('../lib/db.js')).default;

const BASE = 'http://127.0.0.1:4000';
const hash = createHash('sha256').update(process.env.HASH_VALUE || '').digest('hex');

let pass = 0;
let fail = 0;
function expect(label, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

function headers(method, path, body = {}, extra = {}) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...extra,
    ...buildSignatureHeaders({ method, path: path.split('?')[0].replace(/^\/+/, ''), body }),
  };
}
async function req(method, path, body, extra) {
  const res = await fetch(BASE + path, {
    method,
    headers: headers(method, path, body, extra),
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json };
}

// --- 1. the registry itself ---------------------------------------------------
console.log('\n=== action registry ===');
expect('like maps to likeCount', metricFor(ActionType.Like) === 'likeCount', metricFor(ActionType.Like));
expect('share maps to shareCount', metricFor(ActionType.Share) === 'shareCount', metricFor(ActionType.Share));
expect('comment maps to commentCount', metricFor(ActionType.Comment) === 'commentCount', metricFor(ActionType.Comment));
expect('view maps to playCount', metricFor(ActionType.View) === 'playCount', metricFor(ActionType.View));

for (const [name, want] of [
  ['Likes', 'like'],
  ['Shares', 'share'],
  ['Comments', 'comment'],
  ['Views', 'view'],
  ['Followers', 'follow'],
]) {
  expect(`product type "${name}" -> ${want}`, actionFromProductType(name) === want, String(actionFromProductType(name)));
}

// A missing counter must resolve to null, never 0 — that is the free-coins guard.
expect('a missing counter is null, not 0', metricValue({ likeCount: 5 }, ActionType.Share) === null);
expect('an explicit 0 counter stays 0', metricValue({ commentCount: 0 }, ActionType.Comment) === 0);
expect('a non-numeric counter is null', metricValue({ playCount: 'n/a' }, ActionType.View) === null);

// --- 2. the provider really returns the counters ------------------------------
console.log('\n=== live provider counters ===');
const POST_URL = 'https://www.tiktok.com/@fahim1000011/video/7690664473157176584';
const info = await getPostInfo('tiktok', POST_URL);
if (!info || info.isStub) {
  console.log('  SKIP  no live provider configured — counter extraction not exercised here');
} else {
  expect('provider returns likeCount', typeof info.likeCount === 'number', String(info.likeCount));
  expect('provider returns commentCount', typeof info.commentCount === 'number', String(info.commentCount));
  expect('provider returns shareCount', typeof info.shareCount === 'number', String(info.shareCount));
  expect('provider returns playCount', typeof info.playCount === 'number', String(info.playCount));
}

// --- 3. order creation + baseline, per action ---------------------------------
console.log('\n=== order + baseline per action ===');
const login = await req('POST', '/api/v6/login', {
  device_name: 'post-actions-probe',
  id: 'facebook@facebook.ttboost.app',
  username: 'facebook',
  platform: 'facebook',
}, { hash });
const token = login.json?.data?.auth?.token;
console.log(`  login: ${login.status} ${token ? 'ok' : 'no token'}`);
if (!token) {
  console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`}  pass=${pass} fail=${fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
}
const auth = { Authorization: `Bearer ${token}` };

// Cheapest coin-priced package per type, looked up rather than hardcoded so a repricing does
// not break the test.
async function cheapest(typeName) {
  const type = await db.productType.findOne({ where: { name: typeName } });
  if (!type) return null;
  // Coin-priced only: `coinsPrice: null` is a Google Play product, which creates a Pending
  // order that never enters the task feed — sorting naively picked one and the like case
  // silently exercised the wrong path.
  const rows = await db.product.find({
    where: { productTypeId: type.id, coinsPrice: { not: null } },
    sort: { coinsPrice: 'asc' },
    limit: 1,
  });
  return rows[0] ?? null;
}

const CASES = [
  { action: 'like', typeName: 'Likes' },
  { action: 'share', typeName: 'Shares' },
  { action: 'comment', typeName: 'Comments' },
  { action: 'view', typeName: 'Views' },
];

const created = [];
for (const c of CASES) {
  const product = await cheapest(c.typeName);
  expect(`${c.action}: a coin-priced package exists`, !!product, product ? `#${product.id} ${product.coinsPrice}c` : 'none');
  if (!product) continue;

  const res = await req('POST', '/api/v6/orders', {
    platform: 'tiktok',
    username: 'fahim1000011',
    sec_uid: 'MS4wLjABAAAA18WSbFnidj1ajE694xO6GbkyR8l1P48mmpdeHuj-UT9U_IKNhkuGlzTcY4DWiDXh',
    url: POST_URL,
    post_pk: '7690664473157176584',
    product_id: String(product.id),
  }, auth);

  if (res.status !== 200) {
    expect(`${c.action}: order accepted`, false, `HTTP ${res.status} ${res.json?.error_code ?? ''} ${res.json?.message ?? ''}`);
    continue;
  }
  const o = res.json.data;
  created.push(o.id);
  expect(`${c.action}: order accepted`, true, `#${o.id}`);
  expect(`${c.action}: order echoes action_type=${c.action}`, o.action_type === c.action, String(o.action_type));
  expect(`${c.action}: order is anchored to the post`, o.post_id === '7690664473157176584', String(o.post_id));

  // Prime the baseline exactly as the app does before the performer acts.
  const prime = await req('POST', '/api/v6/posts/url', {
    order_id: o.id,
    url: o.url,
    tt_username: 'facebook',
    platform: 'tiktok',
  }, auth);
  expect(`${c.action}: baseline primed`, prime.status === 200, `HTTP ${prime.status} ${prime.json?.error_code ?? ''}`);

  const row = await db.likesCount.findOne({ where: { orderId: o.id }, sort: { id: 'desc' } });
  expect(`${c.action}: baseline row carries metric=${c.action}`, row?.metric === c.action, String(row?.metric));
  expect(
    `${c.action}: baseline recorded a real counter`,
    typeof row?.lastCount === 'number' && row.lastCount >= 0,
    String(row?.lastCount),
  );

  await new Promise((r) => setTimeout(r, 1200)); // RapidAPI throttles bursts
}

// --- 4. the earn rate exists for every action --------------------------------
console.log('\n=== earn rates ===');
const { getInt } = await import('../lib/settings.js');
for (const action of [ActionType.Like, ActionType.Share, ActionType.Comment, ActionType.View]) {
  const key = settingFor(action);
  // Read it the way the checker does, so this catches a missing default as well as a
  // mis-keyed setting: a reward of 0 would mean the task is performed for nothing.
  const reward = await getInt(key, 0);
  expect(`${action}: earns coins (${key} > 0)`, reward > 0, String(reward));
}

console.log(`\ncreated order(s): ${created.join(', ') || '(none)'}`);
console.log(`${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`}  pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
