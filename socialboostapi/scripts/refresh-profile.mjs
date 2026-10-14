// Backdate an Account row's updatedAt so the login route's 2-day reuse window
// expires and it re-fetches the profile from the live TikTok provider.
//
// Run with:
//   node --import ./scripts/register-esm-hook.mjs scripts/refresh-profile.mjs [username]
//
// Uses the native driver (not the Mongoose model) on purpose: Mongoose's
// `timestamps: true` would helpfully overwrite `updatedAt` with "now" on the very
// update that is supposed to make the row look old.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');

const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

const { dbConnect } = await import('../lib/mongodb.js');

const conn = await dbConnect();
const nativeDb = conn.db ?? conn.connection?.db;

const username = (process.argv[2] || 'fahim1000011').toLowerCase();
const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);

const before = await nativeDb.collection('accounts').findOne({ username });
console.log('before :', before ? {
  username: before.username,
  followingCount: before.followingCount,
  followerCount: before.followerCount,
  avatar: String(before.avatarLarger).slice(0, 60),
  updatedAt: before.updatedAt,
} : null);

const res = await nativeDb.collection('accounts').updateMany(
  { username },
  { $set: { updatedAt: threeDaysAgo } }
);
console.log(`backdated ${res.modifiedCount} row(s) for "${username}" to ${threeDaysAgo.toISOString()}`);

process.exit(0);
