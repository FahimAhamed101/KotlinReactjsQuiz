// End-to-end check that the Facebook provider really works against the live
// facebook-scraper3 API.
//
//   node --import ./scripts/register-esm-hook.mjs scripts/test-facebook-provider.mjs
//
// Exercises the REAL code path (facebook.js -> profiles.js), not a hand-rolled curl, so
// a response shape the provider cannot normalise fails here instead of showing an empty
// profile in the app later.
//
// Three cases matter, because Facebook identity is not a single form:
//   - a page with a vanity slug      facebook  -> "Facebook"
//   - a personal profile with a slug  zuck      -> "Mark Zuckerberg"
//   - a numeric-only profile id       4         -> the same person as `zuck`
//
// The calls are paced deliberately. facebook-scraper3 throttles a burst of lookups, and
// a throttled call is indistinguishable from "no such page" at the provider boundary
// (both come back null) — so without the pause this suite reports a false failure on
// whichever case happens to land on the limit, and would "pass" the nonexistent-page
// assertion for the wrong reason.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
require('./load-env.cjs').loadEnv(join(here, '..', '.env'));

const profiles = await import('../lib/services/profiles.js');
const { Platform, profileUrl } = await import('../lib/services/platforms.js');

let fail = 0;
function expect(label, ok, detail = '') {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
}

const pause = () => new Promise((r) => setTimeout(r, 2000));

console.log('\n=== Facebook provider: live check ===\n');
console.log(`hasLiveProvider(facebook)  = ${profiles.hasLiveProvider(Platform.Facebook)}`);
console.log(`hasLiveProvider(instagram) = ${profiles.hasLiveProvider(Platform.Instagram)}`);
console.log(`hasLiveProvider(tiktok)    = ${profiles.hasLiveProvider(Platform.TikTok)}\n`);

expect('facebook provider is live', profiles.hasLiveProvider(Platform.Facebook));

// --- page with a vanity slug -------------------------------------------------------
console.log('\n--- page: facebook ---');
const page = await profiles.getProfileInfo(Platform.Facebook, 'facebook');
if (!page) {
  console.log('FAIL: page profile returned null (throttled or broken)');
  process.exit(1);
}
console.log(JSON.stringify(page, null, 2));
expect('platform stamped as facebook', page.platform === Platform.Facebook, String(page.platform));
expect('username resolved', page.username === 'facebook', String(page.username));
expect('nickname present', !!page.nickname, String(page.nickname));
expect('avatar is a real fbcdn url',
  typeof page.avatarLarger === 'string' && /fbcdn\.net/.test(page.avatarLarger),
  page.avatarLarger ? new URL(page.avatarLarger).host : 'null');
expect('page id captured', !!page.tiktokId, String(page.tiktokId));
expect('followerCount > 0', page.followerCount > 0, String(page.followerCount));

// --- personal profile with a slug --------------------------------------------------
console.log('\n--- profile: zuck ---');
await pause();
const zuck = await profiles.getProfileInfo(Platform.Facebook, 'zuck');
if (!zuck) {
  console.log('FAIL: zuck profile returned null (throttled or broken)');
  process.exit(1);
}
console.log(JSON.stringify(zuck, null, 2));
expect('nickname is Mark Zuckerberg', /zuckerberg/i.test(zuck.nickname || ''), String(zuck.nickname));
expect('followerCount is the live 121,000,000', zuck.followerCount === 121000000, String(zuck.followerCount));
expect('verified flag captured', zuck.verified === true, String(zuck.verified));

// --- the numeric-id form -----------------------------------------------------------
// `profileUrl('4')` must become profile.php?id=4, which is how a numeric-only profile is
// reachable at all.
expect('numeric handle builds a profile.php url',
  profileUrl(Platform.Facebook, '4') === 'https://www.facebook.com/profile.php?id=4',
  profileUrl(Platform.Facebook, '4'));

console.log('\n--- numeric id: 4 ---');
await pause();
const byId = await profiles.getProfileInfo(Platform.Facebook, '4');
console.log(byId ? JSON.stringify(byId, null, 2) : 'null');
expect('numeric id resolves to the same person as zuck',
  !!byId && /zuckerberg/i.test(byId.nickname || ''), byId ? byId.nickname : 'null');

// --- a page that does not exist ----------------------------------------------------
console.log('\n--- nonexistent page ---');
await pause();
const ghost = await profiles.getProfileInfo(
  Platform.Facebook,
  'this_page_definitely_does_not_exist_9z8y7x',
);
console.log(ghost === null ? 'null (correct)' : JSON.stringify(ghost));
expect('nonexistent page returns null', ghost === null);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURES'}\n`);
process.exit(fail ? 1 : 0);