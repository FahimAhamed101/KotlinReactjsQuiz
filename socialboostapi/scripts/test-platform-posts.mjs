// Live check for platform-aware **post** lookups (the anchor for likes orders).
//
//   node --import ./scripts/register-esm-hook.mjs scripts/test-platform-posts.mjs
//
// A likes order stores the post's current like/reaction count as `start_count`, then the
// checker compares against it. Before `lib/services/posts.js`, every consumer imported
// `getPostInfo` from `tiktok.js` directly, so an Instagram or Facebook post returned
// null and the order was refused.
//
// Calls are paced: RapidAPI throttles bursts, and a throttled call returns null just
// like a missing post does.

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
require('./load-env.cjs').loadEnv(join(here, '..', '.env'));

const { getPostInfo, resolvePost, canonicalPostUrl } = await import('../lib/services/posts.js');
const { Platform, profileUrl } = await import('../lib/services/platforms.js');

let fail = 0;
function expect(label, ok, detail = '') {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
}
const pause = () => new Promise((r) => setTimeout(r, 2000));

const cases = [
  {
    platform: Platform.Instagram,
    url: 'https://www.instagram.com/p/tsxp1hhQTG/',
    label: 'instagram post',
  },
  {
    platform: Platform.Facebook,
    url: 'https://www.facebook.com/facebook/posts/pfbid0LHrQLWKipN3tiXseSftSwBeooqwEoZtFvgDuTNKnCDENf81VE6nMr6R4d4bdGH22l',
    label: 'facebook post (pfbid token)',
  },
  {
    platform: Platform.Facebook,
    url: 'https://www.facebook.com/facebook/posts/1710463914458955',
    label: 'facebook post (numeric id)',
  },
];

console.log('\n=== platform post lookups ===\n');
for (const c of cases) {
  const parsed = await resolvePost(c.platform, c.url);
  const canonical = canonicalPostUrl(c.platform, parsed, c.url);
  const post = await getPostInfo(c.platform, canonical || c.url);

  console.log(`${c.label}: parsed=${JSON.stringify(parsed)}`);
  console.log(`  canonical=${canonical}`);
  console.log(`  likeCount=${post?.likeCount ?? 'null'}`);

  expect(`${c.label} parses to a post id`, !!parsed?.postId, String(parsed?.postId));
  expect(`${c.label} produces a canonical url`, !!canonical, String(canonical));
  expect(`${c.label} has a live like count > 0`, (post?.likeCount ?? 0) > 0, String(post?.likeCount));
  await pause();
}

console.log('\n--- profile links must NOT be accepted as posts ---');
for (const [platform, url] of [
  [Platform.Instagram, 'https://www.instagram.com/zuck/'],
  [Platform.Facebook, 'https://www.facebook.com/facebook'],
]) {
  const parsed = await resolvePost(platform, url);
  expect(`${platform} profile link rejected`, parsed === null, JSON.stringify(parsed));
  await pause();
}

console.log('\n--- canonical profile URLs for followers orders ---');
expect('instagram profile url',
  profileUrl(Platform.Instagram, 'demo') === 'https://www.instagram.com/demo/',
  profileUrl(Platform.Instagram, 'demo'));
expect('facebook slug url',
  profileUrl(Platform.Facebook, 'myPage') === 'https://www.facebook.com/myPage',
  profileUrl(Platform.Facebook, 'myPage'));
expect('facebook numeric id url',
  profileUrl(Platform.Facebook, '100064860875397') ===
    'https://www.facebook.com/profile.php?id=100064860875397',
  profileUrl(Platform.Facebook, '100064860875397'));
expect('tiktok profile url',
  profileUrl(Platform.TikTok, 'demo') === 'https://www.tiktok.com/@demo',
  profileUrl(Platform.TikTok, 'demo'));

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURES'}\n`);
process.exit(fail ? 1 : 0);