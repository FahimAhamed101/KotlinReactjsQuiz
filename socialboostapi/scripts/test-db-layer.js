// Verify the MongoDB data layer in lib/db.js against the real database.
//
// Run with:
//   node --import ./scripts/register-esm-hook.mjs scripts/test-db-layer.js
//
// The point is to test the *semantics the call sites rely on*, not just that queries
// return something. Four of these would pass trivially against a naive wrapper while
// still breaking production:
//
//   * a string id ("1") must coerce to a number, because route params are strings
//   * BigInt writes must land as plain numbers, or Mongoose throws a CastError
//   * an un-awaited operation must not have executed — this is what makes
//     `transaction([db.a.create(...), db.b.update(...)])` atomic
//   * a thrown error inside `transaction(cb)` must roll the writes back
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

const { db } = await import('../lib/db.js');

let failures = 0;
let checks = 0;

function ok(label, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const TEST_EMAIL = 'db-layer-test@socialboost.app';

// ---------------------------------------------------------------------------
console.log('\n[1] cleanup from a previous run');
await db.user.deleteMany({ where: { email: TEST_EMAIL } });
ok('no leftover test user', (await db.user.count({ where: { email: TEST_EMAIL } })) === 0);

// ---------------------------------------------------------------------------
console.log('\n[2] create + id allocation (pre-save hook)');
const user = await db.user.create({
  data: { email: TEST_EMAIL, password: TEST_EMAIL, name: 'DB Layer Test', coins: 100, status: 'Active' },
});
ok('numeric id allocated', typeof user.id === 'number' && user.id > 0, `got ${user.id}`);
ok('no _id leaked', !('_id' in user));
ok('no __v leaked', !('__v' in user));

const uid = user.id;

// ---------------------------------------------------------------------------
console.log('\n[3] string-id coercion (route params arrive as strings)');
const byStringId = await db.user.findOne({ where: { id: String(uid) } });
ok('findOne({ id: "5" }) finds the row', byStringId !== null && byStringId.id === uid);

const orderByStringId = await db.order.findOne({ where: { id: '1' } });
ok('findOne on an order by string id works', orderByStringId !== null);

// ---------------------------------------------------------------------------
console.log('\n[4] nested include: order -> product -> productType, user');
const orderInclude = { product: { include: { productType: true } }, user: true };
const feed = await db.order.find({
  where: { type: 'Free' },
  include: orderInclude,
  limit: 2,
  sort: { id: 'asc' },
});
ok('feed returned rows', feed.length > 0, `got ${feed.length}`);
ok('order.product attached', !!feed[0]?.product);
ok('order.product.productType attached (nested)', !!feed[0]?.product?.productType);
ok('productType.name present', typeof feed[0]?.product?.productType?.name === 'string');
ok('order.user attached', !!feed[0]?.user);

// ---------------------------------------------------------------------------
console.log('\n[5] operators: in / not / lt / null');
const inCount = await db.order.count({ where: { status: { in: ['Progress', 'InQueue'] }, deletedAt: null } });
ok('count with { in } + null', inCount >= 0, `got ${inCount}`);

const notSelf = await db.order.find({ where: { userId: { not: uid }, deletedAt: null }, limit: 3 });
ok('find with { not }', notSelf.every((o) => o.userId !== uid));

const ltCount = await db.skipCount.count({ where: { count: { lt: 3 } } });
ok('count with { lt }', ltCount >= 0, `got ${ltCount}`);

// ---------------------------------------------------------------------------
console.log('\n[6] select / sort / skip / limit');
const onlyId = await db.coinsHistory.findOne({ where: { userId: uid }, select: { id: true } });
ok('select { id: true } returns only id', onlyId === null || Object.keys(onlyId).join(',') === 'id', JSON.stringify(onlyId));

const paged = await db.order.find({ sort: { id: 'desc' }, skip: 1, limit: 2 });
ok('skip + limit honoured', paged.length <= 2);
ok('sort desc honoured', paged.length < 2 || paged[0].id > paged[1].id);

// ---------------------------------------------------------------------------
console.log('\n[7] data operators: increment / decrement');
await db.user.update({ where: { id: uid }, data: { coins: { increment: 25 } } });
ok('increment applied', (await db.user.findOne({ where: { id: uid } })).coins === 125);

await db.user.update({ where: { id: uid }, data: { coins: { decrement: 25 } } });
ok('decrement applied', (await db.user.findOne({ where: { id: uid } })).coins === 100);

// ---------------------------------------------------------------------------
console.log('\n[8] BigInt on write (leftover from the old SQL columns)');
const target = await db.order.findOne({ where: { type: 'Free' }, sort: { id: 'asc' } });
const before = target.startCount;
const withBigInt = await db.order.update({
  where: { id: target.id },
  data: { startCount: BigInt(4242) },
});
ok('BigInt stored as a plain number', withBigInt.startCount === 4242, `got ${typeof withBigInt.startCount} ${withBigInt.startCount}`);
ok('reads back as a number', typeof (await db.order.findOne({ where: { id: target.id } })).startCount === 'number');
await db.order.update({ where: { id: target.id }, data: { startCount: before } });

// ---------------------------------------------------------------------------
console.log('\n[9] upsert (find -> create, and the update path on re-run)');
const acc1 = await db.account.upsert({
  where: { username: 'db_layer_test_account' },
  create: { username: 'db_layer_test_account', nickname: 'First' },
  update: { nickname: 'Second' },
});
ok('upsert created', acc1.nickname === 'First' && typeof acc1.id === 'number');

const acc2 = await db.account.upsert({
  where: { username: 'db_layer_test_account' },
  create: { username: 'db_layer_test_account', nickname: 'First' },
  update: { nickname: 'Second' },
});
ok('upsert updated on re-run', acc2.nickname === 'Second');
ok('upsert did not duplicate', (await db.account.count({ where: { username: 'db_layer_test_account' } })) === 1);

// ---------------------------------------------------------------------------
console.log('\n[10] laziness — an un-awaited op must NOT execute');
const pending = db.coinsHistory.create({ data: { userId: uid, type: 'Bonus', gain: 999 } });
const countWhilePending = await db.coinsHistory.count({ where: { userId: uid } });
ok('un-awaited create did not run', countWhilePending === 0, `count=${countWhilePending}`);

const awaited = await pending;
ok('awaiting it does run', awaited.id > 0 && (await db.coinsHistory.count({ where: { userId: uid } })) === 1);

// ---------------------------------------------------------------------------
console.log('\n[11] transaction(array form) — both writes land');
await db.user.update({ where: { id: uid }, data: { coins: { set: 0 } } });
const results = await db.transaction([
  db.coinsHistory.create({ data: { userId: uid, type: 'Bonus', gain: 50 } }),
  db.user.update({ where: { id: uid }, data: { coins: { increment: 50 } } }),
]);
ok('array form returns both results', Array.isArray(results) && results.length === 2, JSON.stringify(results?.length));
ok('coins incremented', (await db.user.findOne({ where: { id: uid } })).coins === 50);
ok('ledger row written', (await db.coinsHistory.count({ where: { userId: uid } })) === 2);

// ---------------------------------------------------------------------------
console.log('\n[12] transaction(callback form) — a throw must roll back');
const coinsBefore = (await db.user.findOne({ where: { id: uid } })).coins;
let threw = false;
try {
  await db.transaction(async (tx) => {
    await tx.user.update({ where: { id: uid }, data: { coins: { increment: 1000 } } });
    await tx.coinsHistory.create({ data: { userId: uid, type: 'Bonus', gain: 1000 } });
    throw new Error('deliberate rollback');
  });
} catch {
  threw = true;
}
ok('error propagated', threw);

const coinsAfter = (await db.user.findOne({ where: { id: uid } })).coins;
ok('coins rolled back', coinsAfter === coinsBefore, `before=${coinsBefore} after=${coinsAfter}`);
ok('ledger row rolled back', (await db.coinsHistory.count({ where: { userId: uid } })) === 2);

// ---------------------------------------------------------------------------
console.log('\n[13] transaction(callback) — commit path + tx handle');
await db.transaction(async (tx) => {
  const u = await tx.user.findOne({ where: { id: uid } });
  await tx.user.update({ where: { id: uid }, data: { coins: { increment: u.coins === 50 ? 7 : 0 } } });
});
ok('tx handle reads and writes', (await db.user.findOne({ where: { id: uid } })).coins === 57);

// ---------------------------------------------------------------------------
console.log('\n[14] update on a missing row throws NOT_FOUND');
let code = null;
try {
  await db.user.update({ where: { id: 999999999 }, data: { coins: { set: 1 } } });
} catch (e) {
  code = e.code;
}
ok('NOT_FOUND raised', code === 'NOT_FOUND', `got ${code}`);

// ---------------------------------------------------------------------------
console.log('\n[15] cleanup');
await db.coinsHistory.deleteMany({ where: { userId: uid } });
await db.account.deleteMany({ where: { username: 'db_layer_test_account' } });
await db.user.deleteMany({ where: { email: TEST_EMAIL } });
ok('test user removed', (await db.user.count({ where: { email: TEST_EMAIL } })) === 0);
ok('test account removed', (await db.account.count({ where: { username: 'db_layer_test_account' } })) === 0);

// ---------------------------------------------------------------------------
console.log(`\n${checks - failures}/${checks} checks passed`);
console.log(failures === 0 ? 'DB LAYER OK' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
