// MongoDB data layer.
//
// This is the single entry point every route and service uses to touch the
// database. It is Mongoose underneath — there is no ORM in front of it and no
// query-builder dependency beyond Mongoose itself.
//
// WHY A SHARED LAYER INSTEAD OF RAW MONGOOSE AT EVERY CALL SITE
// -------------------------------------------------------------
// About thirty files read and write documents. Doing `Model.find(...)` plus a
// manual `populate()` pass at each one would mean re-deriving the same relation
// loading, the same numeric-id coercion and the same projection rules thirty
// times — and every re-derivation is a chance to change the JSON the Android
// client parses. This module centralises those rules so the wire contract has
// exactly one definition.
//
// QUERY SHAPE
// -----------
//   db.<model>.findOne({ where, select, include, sort })
//   db.<model>.find({ where, select, include, sort, skip, limit })
//   db.<model>.create({ data, include })
//   db.<model>.update({ where, data, include })
//   db.<model>.upsert({ where, create, update })
//   db.<model>.count({ where })
//   db.<model>.deleteMany({ where })
//   db.<model>.delete({ where })
//   db.transaction(fn) | db.transaction([...ops])
//
//   where   plain values, null, in / notIn / not / lt / lte / gt / gte / equals,
//           contains / startsWith / endsWith, AND / OR / NOT, compound uniques
//           (`userId_codeId`)
//   data    plain values, { increment }, { decrement }, { multiply }, { divide },
//           { set }
//
// There is no aggregate, groupBy or updateMany usage anywhere in the codebase,
// so none is implemented — a half-implemented aggregate would be worse than an
// honest absence.
//
// FOUR THINGS THAT MATTER AND ARE EASY TO GET WRONG
// -------------------------------------------------
// 1. **Operations are lazy.** `db.order.create({...})` returns a thenable that
//    does not execute until awaited. welcomeBonus.js relies on this: it builds
//    `db.transaction([db.coinsHistory.create(...), db.user.update(...)])`,
//    passing already-invoked calls. If `create` ran eagerly those two writes
//    would land outside the transaction and the array form could never be
//    atomic. `lazy()` below reproduces the deferred behaviour, which is what
//    makes that call site correct.
// 2. **Field coercion is schema-driven, not name-driven.** `Order.orderId` is a
//    String (a Google Play order id) while `CoinsHistory.orderId` is a Number (a
//    foreign key). A rule like "fields named *Id are numeric" would corrupt one
//    of them. Every value is coerced by looking up the actual Mongoose path,
//    which also handles the client sending `product_id: "2"` as a string.
// 3. **BigInt is converted on write.** The ported service code still writes
//    `startCount: BigInt(startCount)`, a leftover from the old SQL columns. The
//    Mongo schema stores plain numbers, so Mongoose would throw a CastError.
//    Coercion absorbs that here instead of requiring an edit in every service.
// 4. **`select: false` fields need a `+`.** See translateSelect below.

import { dbConnect } from './mongodb.js';
import * as models from './models/index.js';

// ---------------------------------------------------------------------------
// Model registry
// ---------------------------------------------------------------------------

/** Model keys are camelCase: `PersonalAccessToken` -> `personalAccessToken`. */
const MODEL_KEYS = {};
for (const [name, Model] of Object.entries(models)) {
  if (typeof Model?.syncIndexes !== 'function') continue; // skip nextId()
  MODEL_KEYS[name.charAt(0).toLowerCase() + name.slice(1)] = name;
}

const OP_KEYS = new Set(['increment', 'decrement', 'multiply', 'divide', 'set']);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

/** Drop Mongo's bookkeeping so callers see exactly the stored document. */
function stripInternals(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const { _id, __v, ...rest } = doc;
  return rest;
}

function toArray(v) {
  return Array.isArray(v) ? v : [v];
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Coerce a value to whatever the schema says the field is.
 * Returns the value untouched when the path is unknown — Mongoose's strict mode will
 * drop the field, which is the lenient behaviour we want for stray input keys.
 */
function coercePath(Model, field, value) {
  if (value === null || value === undefined) return value;

  const path = Model.schema.path(field);
  if (!path) return value;

  if (path.instance === 'Number') {
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
    return value;
  }

  if (path.instance === 'Date') {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? value : d;
    }
    return value;
  }

  if (path.instance === 'String' && typeof value === 'bigint') return value.toString();

  return value;
}

/** An update targeting a row that does not exist is an error, not a silent no-op. */
function notFoundError(modelName, where) {
  const e = new Error(`No ${modelName} document matched the update filter.`);
  e.name = 'DocumentNotFoundError';
  e.code = 'NOT_FOUND';
  e.meta = { modelName, where };
  return e;
}

// ---------------------------------------------------------------------------
// where / data translation
// ---------------------------------------------------------------------------

/** Translate a field filter into a Mongo condition. */
function translateValue(Model, field, raw) {
  if (!isPlainObject(raw)) return coercePath(Model, field, raw);

  const cond = {};
  let sawOperator = false;

  for (const [op, v] of Object.entries(raw)) {
    switch (op) {
      case 'equals':
        cond.$eq = coercePath(Model, field, v);
        sawOperator = true;
        break;
      case 'in':
        cond.$in = toArray(v).map((x) => coercePath(Model, field, x));
        sawOperator = true;
        break;
      case 'notIn':
        cond.$nin = toArray(v).map((x) => coercePath(Model, field, x));
        sawOperator = true;
        break;
      case 'not':
        // `{ not: 5 }` -> `$ne`. A nested filter (`{ not: { in: [...] } }`) has to stay a
        // filter, so it becomes `$not` instead.
        if (isPlainObject(v)) cond.$not = translateValue(Model, field, v);
        else cond.$ne = coercePath(Model, field, v);
        sawOperator = true;
        break;
      case 'lt':
      case 'lte':
      case 'gt':
      case 'gte':
        cond[`$${op}`] = coercePath(Model, field, v);
        sawOperator = true;
        break;
      case 'contains':
        cond.$regex = escapeRegex(v);
        cond.$options = 'i';
        sawOperator = true;
        break;
      case 'startsWith':
        cond.$regex = `^${escapeRegex(v)}`;
        cond.$options = 'i';
        sawOperator = true;
        break;
      case 'endsWith':
        cond.$regex = `${escapeRegex(v)}$`;
        cond.$options = 'i';
        sawOperator = true;
        break;
      case 'mode':
        sawOperator = true; // 'insensitive'; already applied above
        break;
      default:
        break;
    }
  }

  // Not an operator object after all — treat it as a literal.
  return sawOperator ? cond : coercePath(Model, field, raw);
}

function translateWhere(Model, where) {
  const out = {};
  if (!where) return out;

  for (const [key, raw] of Object.entries(where)) {
    if (raw === undefined) continue; // undefined means "no filter"

    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      const list = toArray(raw).map((w) => translateWhere(Model, w));
      out[key === 'NOT' ? '$nor' : `$${key.toLowerCase()}`] = list;
      continue;
    }

    // Compound unique, e.g. `{ userId_codeId: { userId: 1, codeId: 2 } }`.
    // The value object already carries the real field names, so just inline it.
    if (!Model.schema.path(key) && key.includes('_') && isPlainObject(raw)) {
      Object.assign(out, translateWhere(Model, raw));
      continue;
    }

    out[key] = translateValue(Model, key, raw);
  }

  return out;
}

/**
 * Translate `data` into a Mongo update document.
 * Always emits `$set` (possibly empty) so the result is never a bare `{}`, which
 * MongoDB rejects as an update.
 */
function translateData(Model, data) {
  const $set = {};
  const $inc = {};
  const $mul = {};

  for (const [field, value] of Object.entries(data ?? {})) {
    if (value === undefined) continue; // undefined means "leave alone"

    if (isPlainObject(value)) {
      const keys = Object.keys(value);
      const isOperator = keys.length > 0 && keys.every((k) => OP_KEYS.has(k));

      if (isOperator) {
        if (value.set !== undefined) $set[field] = coercePath(Model, field, value.set);
        if (value.increment !== undefined) {
          $inc[field] = ($inc[field] ?? 0) + Number(value.increment);
        }
        if (value.decrement !== undefined) {
          $inc[field] = ($inc[field] ?? 0) - Number(value.decrement);
        }
        if (value.multiply !== undefined) {
          $mul[field] = ($mul[field] ?? 1) * Number(value.multiply);
        }
        if (value.divide !== undefined) {
          $mul[field] = ($mul[field] ?? 1) / Number(value.divide);
        }
        continue;
      }
    }

    $set[field] = coercePath(Model, field, value);
  }

  const update = { $set };
  if (Object.keys($inc).length) update.$inc = $inc;
  if (Object.keys($mul).length) update.$mul = $mul;
  return update;
}

function translateSort(sort) {
  const out = {};
  for (const spec of toArray(sort)) {
    for (const [field, dir] of Object.entries(spec ?? {})) {
      out[field] = dir === 'desc' || dir === -1 ? -1 : 1;
    }
  }
  return out;
}

/**
 * Build a Mongoose projection from a `select`.
 *
 * Returned as a *string* rather than an object because a field declared `select: false`
 * in the schema — `User.adminPasswordHash`, `User.password` — is excluded from an
 * ordinary inclusion projection. Mongoose only returns it when the path is marked with a
 * leading `+`. Explicitly asking for such a field must return it. Without the `+`, admin
 * login reads `adminPasswordHash: undefined` and rejects every correct password, which
 * looks like a wrong-password bug rather than a projection bug.
 */
function translateSelect(Model, select) {
  const parts = ['-_id'];
  for (const [field, on] of Object.entries(select ?? {})) {
    if (!on) continue;
    const hidden = Model.schema.path(field)?.options?.select === false;
    parts.push(hidden ? `+${field}` : field);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Relations (to-one includes)
// ---------------------------------------------------------------------------

/**
 * Which model does `field` point at?
 *
 * Derived from the schema instead of a hand-written map, so it cannot drift as models
 * change: `productId` -> `Product`, `accountId` -> `Account`, `productTypeId` ->
 * `ProductType`. Requiring a **Number** path is what disambiguates the two different
 * `orderId` fields — the String one on Order is a Play order id, not a foreign key —
 * and incidentally rejects `secUid` / `tiktokId`, whose names end in "Id" but which
 * point at nothing.
 */
function relationTarget(Model, field) {
  if (field === 'id' || !field.endsWith('Id')) return null;

  const path = Model.schema.path(field);
  if (!path || path.instance !== 'Number') return null;

  const stem = field.slice(0, -2);
  const name = stem.charAt(0).toUpperCase() + stem.slice(1);
  return MODEL_KEYS[name.charAt(0).toLowerCase() + name.slice(1)] ?? null;
}

/**
 * Attach `include`d relations to already-fetched plain documents.
 * Batched: one query per relation for the whole page, never one per row.
 */
async function attachIncludes(Model, docs, include, session) {
  if (!include || docs.length === 0) return docs;

  for (const [rel, spec] of Object.entries(include)) {
    if (!spec) continue;

    const fk = `${rel}Id`;
    const target = relationTarget(Model, fk);
    if (!target) continue; // not a known to-one relation — leave the key absent

    const ids = [...new Set(docs.map((d) => d[fk]).filter((v) => v !== null && v !== undefined))];
    let related = [];

    if (ids.length) {
      const Target = models[target];
      let q = Target.find({ id: { $in: ids } });
      if (session) q = q.session(session);
      related = (await q.lean().exec()).map(stripInternals);
    }

    const byId = new Map(related.map((r) => [r.id, r]));
    for (const doc of docs) {
      doc[rel] = byId.get(doc[fk]) ?? null;
    }

    const nested = isPlainObject(spec) ? spec.include : null;
    if (nested && related.length) await attachIncludes(models[target], related, nested, session);
  }

  return docs;
}

// ---------------------------------------------------------------------------
// Lazy thenable (see note 1 at the top of this file)
// ---------------------------------------------------------------------------

function lazy(executor) {
  let cached = null;

  const run = (session) => {
    // Every operation opens the connection first. `dbConnect()` is cached, so this is
    // cheap, and without it a plain `node script.js` would queue its query against a
    // connection nobody ever opened — which surfaces 10 seconds later as
    // "Operation `users.deleteMany()` buffering timed out", pointing nowhere useful.
    const go = async () => {
      await dbConnect();
      return executor(session);
    };

    if (session) return go();
    cached ??= go();
    return cached;
  };

  return {
    then: (onFulfilled, onRejected) => run(null).then(onFulfilled, onRejected),
    catch: (onRejected) => run(null).catch(onRejected),
    finally: (onFinally) => run(null).finally(onFinally),
    [Symbol.toStringTag]: 'Promise',
    /** Used by `transaction([...])` to re-run this op inside a session. */
    __run: (session) => run(session),
  };
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

async function runInTransaction(fn) {
  const conn = await dbConnect();

  let session;
  try {
    session = await conn.startSession();
  } catch {
    return fn(null); // no session support — run plainly rather than failing
  }

  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (e) {
    // A standalone mongod (or an old sharded cluster) has no transactions. Degrade to
    // non-transactional execution so a local dev database still works, but make the
    // reduced guarantee visible rather than silent.
    if (/Transaction numbers are only allowed|does not support transactions|not a replica set|IllegalOperation/i.test(e.message ?? '')) {
      console.warn('[db] transactions unavailable, running without one:', e.message);
      return fn(null);
    }
    throw e;
  } finally {
    await session.endSession();
  }
}

// ---------------------------------------------------------------------------
// Model API
// ---------------------------------------------------------------------------

function buildOps(modelKey, session) {
  const Model = models[MODEL_KEYS[modelKey]];

  async function runFind(args = {}, s) {
    const { where, select } = args;
    const sort = args.sort ?? args.orderBy;
    const limit = args.limit ?? args.take;
    const { skip } = args;

    if (limit === 0) return [];

    let q = Model.find(translateWhere(Model, where));
    if (s) q = q.session(s);
    if (sort) q = q.sort(translateSort(sort));
    if (skip) q = q.skip(skip);
    if (limit !== undefined && limit !== null) q = q.limit(limit);
    if (select) q = q.select(translateSelect(Model, select));

    const docs = (await q.lean().exec()).map(stripInternals);
    if (args.include) await attachIncludes(Model, docs, args.include, s);
    return docs;
  }

  async function runFindOne(args = {}, s) {
    const docs = await runFind({ ...args, limit: 1 }, s);
    return docs[0] ?? null;
  }

  async function runCreate(args = {}, s) {
    const fields = translateData(Model, args.data).$set;

    const doc = new Model(fields);
    await doc.save(s ? { session: s } : undefined);

    const obj = stripInternals(doc.toObject());
    if (args.include) await attachIncludes(Model, [obj], args.include, s);
    return obj;
  }

  async function runUpdate(args = {}, s) {
    const update = translateData(Model, args.data);
    const options = { returnDocument: 'after' };
    if (s) options.session = s;

    const doc = await Model.findOneAndUpdate(translateWhere(Model, args.where), update, options).lean();
    if (!doc) throw notFoundError(MODEL_KEYS[modelKey], args.where);

    const obj = stripInternals(doc);
    if (args.include) await attachIncludes(Model, [obj], args.include, s);
    return obj;
  }

  async function runUpsert(args = {}, s) {
    const where = translateWhere(Model, args.where);

    let q = Model.findOne(where);
    if (s) q = q.session(s);
    const existing = await q.lean();

    if (existing) return runUpdate({ ...args, data: args.update }, s);

    try {
      // The unique index on the `where` field is what makes this safe under a race:
      // the loser gets E11000 and retries as an update rather than creating a duplicate.
      return await runCreate({ ...args, data: { ...args.where, ...args.create } }, s);
    } catch (e) {
      if (e.code === 11000) return runUpdate({ ...args, data: args.update }, s);
      throw e;
    }
  }

  async function runCount(args = {}, s) {
    let q = Model.countDocuments(translateWhere(Model, args.where));
    if (s) q = q.session(s);
    return q;
  }

  // The session this client is bound to — set only for the handle passed into
  // `transaction(callback)`. `s` comes from `lazy` and is non-null only for the array
  // form, which re-runs each op inside the transaction session.
  //
  // Both must be consulted. Ignoring the bound session (an earlier version of this
  // file did) makes every write inside `transaction(callback)` run OUTSIDE the
  // transaction: it still succeeds, so nothing looks broken, but a later throw rolls
  // back nothing and the "atomic" block silently loses its guarantee.
  const withSession = (s) => s ?? session;

  return {
    findOne: (args = {}) => lazy((s) => runFindOne(args, withSession(s))),
    find: (args = {}) => lazy((s) => runFind(args, withSession(s))),
    create: (args = {}) => lazy((s) => runCreate(args, withSession(s))),
    update: (args = {}) => lazy((s) => runUpdate(args, withSession(s))),
    upsert: (args = {}) => lazy((s) => runUpsert(args, withSession(s))),
    count: (args = {}) => lazy((s) => runCount(args, withSession(s))),

    deleteMany: (args = {}) =>
      lazy(async (s) => {
        let q = Model.deleteMany(translateWhere(Model, args.where));
        const session = withSession(s);
        if (session) q = q.session(session);
        const res = await q;
        return { count: res.deletedCount ?? 0 };
      }),

    delete: (args = {}) =>
      lazy(async (s) => {
        let q = Model.findOneAndDelete(translateWhere(Model, args.where));
        const session = withSession(s);
        if (session) q = q.session(session);
        const doc = await q.lean();
        if (!doc) throw notFoundError(MODEL_KEYS[modelKey], args.where);
        return stripInternals(doc);
      }),
  };
}

/** A client whose operations all run inside `session` (or none when null). */
function buildClient(session) {
  const client = {};
  for (const modelKey of Object.keys(MODEL_KEYS)) {
    client[modelKey] = buildOps(modelKey, session);
  }

  client.transaction = (arg) => {
    if (typeof arg === 'function') {
      return runInTransaction((session) => arg(buildClient(session)));
    }

    if (Array.isArray(arg)) {
      return runInTransaction(async (session) => {
        const results = [];
        for (const op of arg) {
          if (typeof op?.__run !== 'function') {
            throw new Error('transaction([...]) expects the result of a db model call');
          }
          results.push(await op.__run(session));
        }
        return results;
      });
    }

    throw new Error('transaction expects a callback or an array of operations');
  };

  client.disconnect = async () => {};
  client.connect = async () => {
    await dbConnect();
  };

  return client;
}

export const db = buildClient(null);
export default db;
