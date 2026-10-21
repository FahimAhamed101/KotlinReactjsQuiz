const p = await import('../lib/services/platforms.js');
const { Platform: P } = p;

let fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
}

console.log('--- profileUrl ---');
check(`profileUrl ig`, p.profileUrl(P.Instagram, 'someone'), 'https://www.instagram.com/someone/');
check(`profileUrl fb handle`, p.profileUrl(P.Facebook, 'somepage'), 'https://www.facebook.com/somepage');
check(`profileUrl fb numeric`, p.profileUrl(P.Facebook, '100029888651259'),
  'https://www.facebook.com/profile.php?id=100029888651259');
check(`profileUrl tt`, p.profileUrl(P.TikTok, 'fahim1000011'), 'https://www.tiktok.com/@fahim1000011');

console.log('\n--- parseProfileUrl (paste a profile link) ---');
check(`fb link`, p.parseProfileUrl(P.Facebook, 'https://www.facebook.com/profile.php?id=100029888651259'),
  '100029888651259');
check(`ig link`, p.parseProfileUrl(P.Instagram, 'https://www.instagram.com/fahim_prime3000/'),
  'fahim_prime3000');
check(`tt link`, p.parseProfileUrl(P.TikTok, 'https://www.tiktok.com/@fahim1000011'), 'fahim1000011');
check(`bare handle`, p.parseProfileUrl(P.Instagram, 'fahim_prime3000'), 'fahim_prime3000');
check(`fb reels rejected`, p.parseProfileUrl(P.Facebook, 'https://www.facebook.com/reels/123'), 'reels');
check(`ig explore rejected`, p.parseProfileUrl(P.Instagram, 'https://www.instagram.com/explore/tags/demo'), null);
check(`cross-platform rejected`, p.parseProfileUrl(P.Instagram, 'https://www.tiktok.com/@demo'), null);

console.log('\n--- parsePostUrl ---');
check(`tt video`, p.parsePostUrl(P.TikTok, 'https://www.tiktok.com/@fahim1000011/video/7690664473157176584'),
  { username: 'fahim1000011', postId: '7690664473157176584', kind: 'video' });
check(`ig post`, p.parsePostUrl(P.Instagram, 'https://www.instagram.com/p/CxYzAbCdEfG/'),
  { username: null, postId: 'CxYzAbCdEfG', kind: 'post' });
check(`ig reel`, p.parsePostUrl(P.Instagram, 'https://www.instagram.com/reel/CxYzAbCdEfG/'),
  { username: null, postId: 'CxYzAbCdEfG', kind: 'reel' });
check(`fb posts`, p.parsePostUrl(P.Facebook, 'https://www.facebook.com/somepage/posts/123456'),
  { username: 'somepage', postId: '123456', kind: 'post' });
check(`fb share/p (needs redirect)`,
  p.parsePostUrl(P.Facebook, 'https://www.facebook.com/share/p/1FNbFrGLVn/'),
  { username: null, postId: '1FNbFrGLVn', kind: 'post' });
check(`fb photo fbid`, p.parsePostUrl(P.Facebook, 'https://www.facebook.com/photo/?fbid=999'),
  { username: null, postId: '999', kind: 'photo' });
check(`fb profile rejected`, p.parsePostUrl(P.Facebook, 'https://www.facebook.com/somepage'), null);
check(`ig profile rejected`, p.parsePostUrl(P.Instagram, 'https://www.instagram.com/someone/'), null);
check(`tt profile rejected`, p.parsePostUrl(P.TikTok, 'https://www.tiktok.com/@someone'), null);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILURES'}`);
process.exit(fail ? 1 : 0);
