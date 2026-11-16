// Repair one account on one platform from the live provider, then mirror its avatar.
//
//   node --import ./scripts/register-esm-hook.mjs scripts/fix-account.mjs instagram fahimahmed1000012
//
// Writes through the canonical `upsertAccountFromProfile` so the row is identical to one
// created by login — the only difference is that it is driven from a machine that has the
// provider key. The mirrored bytes matter: the deployment is keyed on nothing but the
// database, so a mirror written here is what production serves.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('./load-env.cjs').loadEnv('.env');

const { dbConnect } = await import('../lib/mongodb.js');
const { getProfileInfo } = await import('../lib/services/profiles.js');
const { upsertAccountFromProfile } = await import('../lib/services/coinsCheck.js');
const { mirrorAvatar, getMirroredAvatar } = await import('../lib/services/avatar.js');

const platform = (process.argv[2] || '').toLowerCase();
const username = (process.argv[3] || '').toLowerCase();
if (!platform || !username) {
  console.error('usage: fix-account.mjs <platform> <username>');
  process.exit(2);
}

await dbConnect();

const info = await getProfileInfo(platform, username);
if (!info) {
  console.error(`${platform}/${username}: provider returned no profile (does not exist, or throttled)`);
  process.exit(1);
}
if (info.isStub) {
  console.error(`${platform}/${username}: provider is stubbed (no key) — refusing to write a fake profile`);
  process.exit(1);
}

console.log('provider:', {
  platform,
  username: info.username,
  nickname: info.nickname,
  followers: info.followerCount,
  following: info.followingCount,
  avatar: String(info.avatarLarger || '').slice(0, 90),
});

const saved = await upsertAccountFromProfile({ ...info, platform });
console.log('row saved:', saved ? {
  platform: saved.platform,
  username: saved.username,
  avatarLarger: String(saved.avatarLarger || '').slice(0, 90),
} : '(upsert returned nothing)');

const mirrored = await mirrorAvatar(platform, username, info.avatarLarger);
console.log('mirror written:', mirrored);

const check = await getMirroredAvatar(platform, username);
console.log('mirror readable:', check ? { bytes: check.data?.length ?? 0, contentType: check.contentType } : null);

process.exit(0);