// End-to-end check of the order lifecycle endpoints:
//   GET    /v6/orders/{id}      order detail
//   DELETE /v6/orders           delete a pending, unpaid order
//   POST   /v6/orders/reactivate revive a cancelled order, once
//
// The reactivate path needs a *cancelled* order, which the demo account does not
// normally have, so the script flips one and restores its original state afterwards.
// It is re-runnable.
//
// Run with: node --import ./scripts/register-esm-hook.mjs scripts/test-order-lifecycle.js
//
// NOTE: this script deliberately drives the SAME data layer the server uses
// (`lib/db.js`, the Prisma-shaped facade over MongoDB). It previously constructed its
// own `new PrismaClient()`, which pointed at the old SQLite file: the setup rows it
// created were invisible to the server and the rows it verified were never the ones the
// server had written. Every failure looked like a server bug while the server was
// behaving correctly. A test that reads a different database than the code under test
// proves nothing.
import crypto from 'crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { signatureHeaders } = require('./signing.cjs');
const { loadEnv } = require('./load-env.cjs');

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

const { db } = await import('../lib/db.js');

const BASE = 'http://127.0.0.1:4000';
const HASH = crypto.createHash('sha256').update('nesyou is the best').digest('hex');

let failures = 0;

function assert(label, condition, detail = '') {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

async function call(method, path, body, token, extraHeaders = {}) {
  const headers = {
    Accept: 'application/json',
    ...(await signatureHeaders(method, path, body)),
    ...extraHeaders,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

const codeOf = (r) => r.json.error_code ?? (r.json.success ? 'success' : 'unknown');

const creds = { device_name: 'lifecycle-test', id: 'demo@ttboost.app', username: 'demo_user' };
const login = await call('POST', '/api/v6/login', creds, null, { hash: HASH });
const token = login.json.data?.auth?.token;
if (!token) {
  console.log('FAIL  demo login:', JSON.stringify(login.json).slice(0, 300));
  process.exit(1);
}
const user = login.json.data?.user;

const mine = (await call('GET', '/api/v6/me/orders?page=1', null, token)).json.data?.data ?? [];
console.log(`--- signed in, ${mine.length} of my orders ---`);
assert('demo account has orders to work with', mine.length > 0);
if (mine.length === 0) process.exit(1);

// ================= Part A: order detail =================
const sample = mine[0];
const detail = await call('GET', `/api/v6/orders/${sample.id}`, null, token);
assert('GET /orders/{id} succeeds', detail.json.success === true, codeOf(detail));
assert('detail returns the right order', detail.json.data?.id === sample.id, `id=${detail.json.data?.id}`);
assert(
  'detail carries the status the client renders',
  typeof detail.json.data?.status === 'string',
  `status=${detail.json.data?.status}`,
);

const bogusDetail = await call('GET', '/api/v6/orders/99999999', null, token);
assert('unknown order id refused with MissingArgument', codeOf(bogusDetail) === 'MissingArgument', codeOf(bogusDetail));

const malformedDetail = await call('GET', '/api/v6/orders/not-a-number', null, token);
assert('non-numeric order id refused with MissingArgument', codeOf(malformedDetail) === 'MissingArgument', codeOf(malformedDetail));

// ================= Part B: delete =================
console.log('\n--- delete ---');
let pending = mine.find((o) => o.status === 'Pending');

if (!pending) {
  // No pending order to delete — make one from a Play-priced product.
  const products = (await call('GET', '/api/v6/products', null, token)).json.data ?? [];
  const play = products.find((p) => p.coins_price == null);
  if (play) {
    const tt = login.json.data?.tiktok_info ?? {};
    const created = await call(
      'POST',
      '/api/v6/orders',
      {
        sec_uid: tt.secUid,
        username: tt.uniqueId ?? 'demo_user',
        url: `https://www.tiktok.com/@${tt.uniqueId ?? 'demo_user'}`,
        product_id: String(play.id),
      },
      token,
    );
    if (created.json.success && created.json.data?.status === 'Pending') {
      pending = created.json.data;
      console.log(`      created pending order #${pending.id} for the delete test`);
    } else {
      console.log(`      could not create a pending order: ${codeOf(created)}`);
    }
  }
}

if (!pending) {
  console.log('SKIP  no pending order available (the pending-order cap is full)');
} else {
  const deleted = await call('DELETE', '/api/v6/orders', { order_id: pending.id }, token);
  assert('deleting a pending order succeeds', deleted.json.success === true, codeOf(deleted));

  const again = await call('DELETE', '/api/v6/orders', { order_id: pending.id }, token);
  assert('deleting it twice refused with OrderNotFound', codeOf(again) === 'OrderNotFound', codeOf(again));

  const row = await db.order.findOne({ where: { id: pending.id } });
  assert('the row is soft-deleted, not destroyed', row !== null && row.deletedAt !== null,
    row ? `deletedAt=${row.deletedAt ? 'set' : 'null'}` : 'row missing');
  assert('the deletion is tagged with the billing-not-proceeded reason',
    row?.reason === 'Billing_Initiated_But_Not_Proceed', `reason=${row?.reason}`);
}

const nonPending = mine.find((o) => o.status !== 'Pending');
if (nonPending) {
  const refused = await call('DELETE', '/api/v6/orders', { order_id: nonPending.id }, token);
  assert(
    `a ${nonPending.status} order cannot be deleted`,
    codeOf(refused) === 'OrderNotDeletable',
    codeOf(refused),
  );
}

const bogusDelete = await call('DELETE', '/api/v6/orders', { order_id: 99999999 }, token);
assert('deleting an unknown order refused with OrderNotFound', codeOf(bogusDelete) === 'OrderNotFound', codeOf(bogusDelete));

// ================= Part C: reactivate =================
console.log('\n--- reactivate ---');
const notCancelled = mine.find((o) => o.status === 'Progress' || o.status === 'Completed');
if (notCancelled) {
  const r = await call('POST', '/api/v6/orders/reactivate', { order_id: notCancelled.id }, token);
  assert(
    `a ${notCancelled.status} order is not reactivatable (MissingArgument)`,
    codeOf(r) === 'MissingArgument',
    codeOf(r),
  );
}

// Set up a genuinely cancelled order to exercise the happy path.
const candidate = await db.order.findOne({
  where: { userId: user.id, deletedAt: null, status: 'Progress' },
  sort: { id: 'desc' },
});

if (!candidate) {
  console.log('SKIP  no Progress order available to cancel for the reactivate test');
} else {
  const original = {
    status: candidate.status,
    reason: candidate.reason,
    reactivationCount: candidate.reactivationCount,
    reactivatedAt: candidate.reactivatedAt,
    clicks: candidate.clicks,
    startCount: candidate.startCount,
    expectedCount: candidate.expectedCount,
  };

  await db.order.update({
    where: { id: candidate.id },
    data: {
      // Canonical spelling, and the human-readable message the checker writes —
      // Order::normalizedCancelReason() maps it back to the Unavailable_Video code.
      status: 'Cancelled',
      reason: 'Video is unavailable',
      reactivationCount: 0,
      reactivatedAt: null,
      adminCanceled: false,
    },
  });
  console.log(`      order #${candidate.id} flipped to Cancelled for the test`);

  const ok = await call('POST', '/api/v6/orders/reactivate', { order_id: candidate.id }, token);
  assert('reactivating a cancelled order succeeds', ok.json.success === true, codeOf(ok));
  assert('reactivation_count became 1', ok.json.data?.reactivation_count === 1, `count=${ok.json.data?.reactivation_count}`);
  assert('reactivated_at is set', !!ok.json.data?.reactivated_at, `${ok.json.data?.reactivated_at}`);
  assert(
    'the order is running again',
    ['Progress', 'InQueue'].includes(ok.json.data?.status),
    `status=${ok.json.data?.status}`,
  );

  // Flip it back to cancelled, keeping the reactivation count, to prove the
  // once-only rule is enforced rather than merely unreachable. The legacy
  // single-L spelling is used on purpose: rows written by an earlier build of
  // this port carry it, and the reactivation guard has to keep recognising them.
  await db.order.update({ where: { id: candidate.id }, data: { status: 'Canceled' } });

  const twice = await call('POST', '/api/v6/orders/reactivate', { order_id: candidate.id }, token);
  assert(
    'a second reactivation is refused',
    twice.json.success === false && twice.status === 422,
    `http ${twice.status} ${codeOf(twice)}`,
  );
  assert(
    'the refusal explains it was already reactivated',
    String(twice.json.message ?? '').includes('already been reactivated'),
    twice.json.message,
  );

  // A refunded order must never be reactivatable.
  await db.order.update({
    where: { id: candidate.id },
    data: { reason: 'Refunded', reactivationCount: 0 },
  });

  const refunded = await call('POST', '/api/v6/orders/reactivate', { order_id: candidate.id }, token);
  assert(
    'a refunded order is refused',
    refunded.json.success === false && refunded.status === 422,
    `http ${refunded.status} ${refunded.json.message}`,
  );
  assert(
    'the refusal names the cancellation reason',
    String(refunded.json.message ?? '').includes('Refunded'),
    refunded.json.message,
  );

  // ...and the resource must agree, or the client would show a dead button.
  const after = await call('GET', `/api/v6/orders/${candidate.id}`, null, token);
  assert(
    'can_reactivate is false for a refunded order',
    after.json.data?.can_reactivate === false,
    `can_reactivate=${after.json.data?.can_reactivate}`,
  );

  // Restore the order to how we found it.
  await db.order.update({ where: { id: candidate.id }, data: original });
  console.log(`      order #${candidate.id} restored to ${original.status}`);
}

await db.disconnect();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
