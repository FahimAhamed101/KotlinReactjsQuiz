// End-to-end check that the Instagram provider really works against the live
// instagram-looter2 API for a given handle.
//
//   node --import ./scripts/register-esm-hook.mjs scripts/test-instagram-provider.mjs [username]
//
// It exercises the REAL code path (instagram.js -> profiles.js), not a hand-rolled
// curl, so a shape the provider cannot normalise fails here instead of silently
// showing "0 followers" in the app later.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
require('./load-env.cjs').loadEnv(join(here, '..', '.env'));

const handle = (process.argv[2] || 'fahim_prime3000').replace(/^@/, '').toLowerCase();

const instagram = await import('../lib/services/instagram.js');
const profiles = await import('../lib/services/profiles.js');
const { Platform } = await import('../lib/services/platforms.js');

let fail = 0;
function expect(label, ok, detail = '') {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
}

console.log(`\n=== Instagram provider: live check for @${handle} ===\n`);

console.log(`hasLiveProvider(instagram) = ${profiles.hasLiveProvider(Platform.Instagram)}`);
console.log(`hasLiveProvider(tiktok)    = ${profiles.hasLiveProvider(Platform.TikTok)}\n`);

expect('instagram provider is live', profiles.hasLiveProvider(Platform.Instagram));
expect('tiktok provider is live', profiles.hasLiveProvider(Platform.TikTok));

const p = await profiles.getProfileInfo(Platform.Instagram, handle);

if (!p) {
  console.log('\nFAIL: getProfileInfo returned null — no profile resolved\n');
  process.exit(1);
}

console.log(JSON.stringify(p, null, 2));
console.log('');

expect('platform stamped as instagram', p.platform === Platform.Instagram, String(p.platform));
expect('username resolved', !!p.username, String(p.username));
expect('nickname present', !!p.nickname, String(p.nickname));
expect('avatar present', !!p.avatarLarger, p.avatarLarger ? p.avatarLarger.slice(0, 48) + '...' : 'null');
expect('avatar is a real instagram CDN url',
  typeof p.avatarLarger === 'string' && /cdninstagram\.com|fbcdn\.net/.test(p.avatarLarger),
  p.avatarLarger ? new URL(p.avatarLarger).host : 'null');
expect('numeric id captured', !!p.tiktokId, String(p.tiktokId));
expect('followerCount > 0', p.followerCount > 0, String(p.followerCount));
expect('followingCount > 0', p.followingCount > 0, String(p.followingCount));
expect('signature present', !!p.signature, (p.signature || '').slice(0, 40));

// The looter2 fixture we verified by hand: 14 followers / 8 following.
expect('followerCount matches live API (14)', p.followerCount === 14, String(p.followerCount));
expect('followingCount matches live API (8)', p.followingCount === 8, String(p.followingCount));

// A handle that does not exist must resolve to null, not a stub.
const ghost = await profiles.getProfileInfo(Platform.Instagram, 'this_handle_definitely_does_not_exist_9z8y7x');
console.log('');
console.log(`nonexistent handle -> ${ghost === null ? 'null (correct)' : JSON.stringify(ghost)}`);
expect('nonexistent handle returns null', ghost === null);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURES'}\n`);
process.exit(fail ? 1 : 0);
