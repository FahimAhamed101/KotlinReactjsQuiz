// MongoDB (Atlas) connection.
//
// Cached on globalThis so Next.js hot-reload does not open a fresh pool on every
// reload — without this, a dev session leaks connections until Atlas refuses them.
//
// The `mongodb+srv://` scheme requires a DNS SRV lookup, and Node's c-ares resolver
// refuses that on some machines/networks (`querySrv ECONNREFUSED`). That is a
// resolver problem, not a credential problem, and it is indistinguishable from a
// broken database unless handled — so MONGODB_URI_FALLBACK carries the same cluster
// as an explicit seed list and is retried only when the failure looks like DNS.
// Get the shard hosts from DNS-over-HTTPS if they ever change:
//   https://dns.google/resolve?name=_mongodb._tcp.<cluster>.mongodb.net&type=SRV
//   https://dns.google/resolve?name=<cluster>.mongodb.net&type=TXT   (replicaSet)

import mongoose from 'mongoose';

const SRV_URI = process.env.MONGODB_URI;
const FALLBACK_URI = process.env.MONGODB_URI_FALLBACK;
const DB_NAME = process.env.MONGODB_DB || 'coinapp';

// Fail loud. Silently connecting to nothing produces "no users found" screens that
// look like a bug in the admin panel rather than a missing environment variable.
if (!SRV_URI) {
  throw new Error('MONGODB_URI is not set — refusing to start without a database.');
}

const DNS_LIKE = /querySrv|_mongodb\._tcp|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/i;

const cached = (globalThis.__ttboostMongo ??= { conn: null, promise: null, transport: null });

async function connect(uri) {
  // `bufferCommands: false` makes a query issued before the connection is open throw
  // immediately. The default buffers it for 10s and then reports
  // "Operation `users.deleteMany()` buffering timed out", which names the query rather
  // than the real problem (nothing ever called dbConnect) and costs 10s to find out.
  mongoose.set('bufferCommands', false);
  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    dbName: DB_NAME,
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 15000,
  });
  return mongoose.connection;
}

/**
 * Connect once and reuse. Safe to call from every route handler.
 * @returns {Promise<import('mongoose').Connection>}
 */
export async function dbConnect() {
  if (cached.conn) return cached.conn;

  cached.promise ??= (async () => {
    try {
      const conn = await connect(SRV_URI);
      cached.transport = 'srv';
      return conn;
    } catch (e) {
      if (!FALLBACK_URI || !DNS_LIKE.test(e.message)) throw e;
      console.warn(`[mongodb] SRV lookup failed (${e.message}); retrying with the seed-list fallback.`);
      const conn = await connect(FALLBACK_URI);
      cached.transport = 'fallback';
      return conn;
    }
  })();

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    // Reset so the next request retries instead of caching the failure forever.
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

/** Which URI actually worked — surfaced by /api/health so a stale server is obvious. */
export function transport() {
  return cached.transport;
}

export default dbConnect;
