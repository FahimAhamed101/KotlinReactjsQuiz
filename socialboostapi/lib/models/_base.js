// Shared model plumbing.
//
// **Why numeric ids at all?** The Prisma schema used `Int @id @default(autoincrement())`
// and that leaked into the client contract: the Android app sends `product_id: "2"` and
// reads `order.id` as a number. MongoDB's native `_id` is an ObjectId, so switching to it
// would silently change the API. Instead every document also carries an `id: Number`
// allocated from an atomic counter, and `_id` stays an implementation detail.
//
// **Why camelCase keys?** Prisma's JS client already exposed camelCase (`o.startCount`,
// `o.reactivationCount`) while mapping to snake_case columns. Storing camelCase in Mongo
// means `lib/resources.js` and the services keep working untouched, which is what keeps
// this migration low-risk. Nothing outside the database depends on key casing.

import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema(
  {
    _id: { type: String }, // the collection name, e.g. "orders"
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);

const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema, 'counters');

/**
 * Atomically allocate the next numeric id for a collection.
 * `findOneAndUpdate` with `$inc` is atomic on a single document, so two concurrent
 * inserts cannot receive the same id.
 */
export async function nextId(name) {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    // `new: true` still works but mongoose 8 warns on every call. `returnDocument`
    // is the supported spelling.
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
  ).lean();

  return doc.seq;
}

/**
 * Give a schema the shared `id: Number` field and allocate it on insert.
 *
 * Note this covers `save()` and `insertMany()` — the paths application code uses.
 * `updateOne(..., { upsert: true })` deliberately does *not* allocate, because seeds
 * supply explicit ids so re-running is idempotent.
 */
export function autoId(schema, name) {
  schema.add({ id: { type: Number, unique: true, index: true } });

  schema.pre('save', async function allocateId() {
    if (this.id === undefined || this.id === null) this.id = await nextId(name);
  });

  schema.pre('insertMany', async function allocateIds(_next, docs) {
    for (const doc of docs) {
      if (doc.id === undefined || doc.id === null) doc.id = await nextId(name);
    }
  });

  return schema;
}

/**
 * Register a model once. Next.js re-evaluates modules on hot reload, and calling
 * `mongoose.model()` twice for the same name throws OverwriteModelError.
 */
export function defineModel(name, schema, collection) {
  return mongoose.models[name] || mongoose.model(name, schema, collection);
}

/** Hide Mongo internals from anything that serialises a document. */
export function withJsonShape(schema) {
  schema.set('toJSON', {
    versionKey: false,
    transform: (_doc, ret) => {
      delete ret._id;
      return ret;
    },
  });
  return schema;
}

/**
 * Declare a unique index that tolerates any number of "not set yet" rows.
 *
 * `sparse: true` *looks* like it does this, and it does not. Sparse only skips
 * documents where the field is ABSENT — but every model here declares
 * `default: null`, so the field is always PRESENT and sparse never applies. The
 * second row without a value then collides on null:
 *
 *   E11000 duplicate key error collection: coinapp.orders
 *     index: purchaseToken_1 dup key: { purchaseToken: null }
 *
 * A partial index restricted to actual values is the real equivalent of a
 * nullable-unique column, which is precisely what Prisma's `@unique` on a
 * nullable field produced (SQL treats NULLs as distinct).
 *
 * `default: null` is kept deliberately rather than dropped: dropping it would
 * leave the field `undefined`, and `JSON.stringify` omits undefined keys, so the
 * Android client would see the key vanish instead of arriving as null — a silent
 * contract change.
 *
 * Usage: `schema.index(...uniqueWhenPresent('purchaseToken'));`
 */
export function uniqueWhenPresent(field, bsonType = 'string') {
  return [
    { [field]: 1 },
    { unique: true, partialFilterExpression: { [field]: { $type: bsonType } } },
  ];
}
