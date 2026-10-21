// Repair TikTok profile pictures.
//
// Symptom this exists for: every avatar in the app renders as a random placeholder, or
// as an empty ring. Two independent causes, both repaired here:
//
//   1. `accounts` rows held the OFFLINE STUB profile — picsum avatar, invented signature,
//      hash-derived follower counts — because a login against the deployment (which has
//      no RAPID_API_KEY) re-fetched the profile and blindly overwrote the real row.
//      `upsertAccountFromProfile` now refuses to do that; this script puts the real data
//      back by fetching with the key that only exists in the local .env.
//
//   2. `orders.image` is a snapshot taken at order time, and those snapshots are TikTok
//      CDN URLs that expire in ~2 days. Orders placed while the stub was in place froze a
//      picsum URL forever. They are re-pointed at the account's current real avatar.
//
// The avatar bytes are also mirrored into the `avatars` collection, so the picture no
// longer depends on a signed URL staying valid.
//
//   node --import ./scripts/register-esm-hook.mjs scripts/repair-avatars.mjs [username...]
//
// With no arguments it repairs every account row. Pass usernames to limit it.

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');

const db = (await import('../lib/db.js')).default;
const { getProfileInfo, hasLiveProvider } = await import('../lib/services/tiktok.js');
const { upsertAccountFromProfile } = await import('../lib/services/coinsCheck.js');
const { mirrorAvatar, isPlaceholderAvatar } = await import('../lib/services/avatar.js');

if (!hasLiveProvider()) {
  console.error(
    'RAPID_API_KEY is not set — every fetch would return the offline stub and repair nothing.\n' +
      'Set it in socialboostapi/.env first.',
  );
  process.exit(1);
}

const only = process.argv.slice(2).map((s) => s.toLowerCase());
const where = only.length ? { username: { in: only } } : {};
const accounts = await db.account.find({ where, limit: 500 });
console.log(`repairing ${accounts.length} account(s)\n`);

let fixed = 0;
let mirrored = 0;
let failed = 0;

for (const account of accounts) {
  const before = account.avatarLarger ?? '(none)';
  const wasStub = isPlaceholderAvatar(before);

  const profile = await getProfileInfo(account.username, account.secUid);
  if (!profile || profile.isStub) {
    console.log(`SKIP  @${account.username}: provider returned nothing usable`);
    failed++;
    continue;
  }

  const saved = await upsertAccountFromProfile(profile);
  const after = saved?.avatarLarger ?? null;

  let didMirror = false;
  if (after && !isPlaceholderAvatar(after)) {
    didMirror = await mirrorAvatar(saved.platform, saved.username, after);
  }

  console.log(
    `${wasStub ? 'FIX ' : 'SYNC'} @${account.username}  ` +
      `avatar=${didMirror ? 'mirrored' : 'upstream only'}  ` +
      `following=${saved.following} follower=${saved.follower}  ` +
      `signature=${JSON.stringify(saved.signature)}`,
  );
  if (wasStub) fixed++;
  if (didMirror) mirrored++;

  // Re-point this account's frozen order snapshots at the real picture.
  if (after && !isPlaceholderAvatar(after)) {
    const stale = await db.order.find({
      where: { accountId: account.id, deletedAt: null },
      limit: 500,
    });
    for (const order of stale) {
      if (order.image === after) continue;
      await db.order.update({ where: { id: order.id }, data: { image: after } });
    }
    if (stale.length) console.log(`      re-pointed ${stale.length} order snapshot(s)`);
  }
}

console.log(
  `\ndone: ${fixed} stub row(s) repaired, ${mirrored} avatar(s) mirrored, ${failed} skipped`,
);
process.exit(0);
