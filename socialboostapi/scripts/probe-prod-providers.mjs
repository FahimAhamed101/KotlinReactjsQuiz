// Prove the deployed build can actually *see* profiles on each network.
//
// Background: production used to have RAPID_API_KEY but no Instagram/Facebook
// credentials, and every live task target is an Instagram account. The verifier
// therefore answered "cannot see it" for every task, which the client surfaces as
// "Could not verify". This probe asks the deployed API the same question the
// verifier asks, so it distinguishes "keys are live" from "keys are missing"
// without needing a phone.
//
// The important field is `isStub`: the provider layer returns a deterministic
// placeholder when no scraping key is configured, and a stub is never evidence
// that an action happened.
//
// Run:
//   node --import ./scripts/register-esm-hook.mjs scripts/probe-prod-providers.mjs [baseUrl]

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');
const { buildSignatureHeaders } = await import('../lib/signature.js');

const base = process.argv[2] || 'https://kotlin-reactjs-quiz-xi.vercel.app';

const targets = [
  ['instagram', 'fahimahmed1000012'],
  ['instagram', 'fahim_prime3000'],
  ['facebook', 'nike'],
  ['tiktok', 'fahim1000011'],
];

for (const [platform, username] of targets) {
  const path = `/api/v6/lookup/${platform}/${encodeURIComponent(username)}`;
  let line = `${platform.padEnd(10)} ${username.padEnd(20)}`;
  try {
    const res = await fetch(base + path, {
      headers: {
        Accept: 'application/json',
        ...buildSignatureHeaders({
          method: 'GET',
          path: path.replace(/^\/+/, ''),
          body: {},
        }),
      },
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON is reported raw below */
    }

    // The lookup route keeps the legacy `tiktok_info` key for the deployed client,
    // whatever the platform, so the profile hangs off that.
    const p = parsed?.data?.tiktok_info || parsed?.profile || parsed?.data || parsed || {};
    const stub = p?.isStub;
    const followers = p?.followerCount ?? p?.follower_count ?? p?.followers;
    const following = p?.followingCount ?? p?.following_count ?? p?.following;
    const avatarHost = String(p?.avatarLarger || p?.avatar || '').replace(/^https?:\/\//, '').split('/')[0];

    line += `status=${String(res.status).padEnd(4)} stub=${String(stub).padEnd(5)}`;
    line += ` followers=${String(followers).padEnd(6)} following=${String(following).padEnd(6)} host=${avatarHost}`;

    // A placeholder avatar host is the tell-tale of a key-less build, because the
    // stub writes picsum.photos and nothing else does.
    if (stub === true || avatarHost.includes('picsum')) line += '  <-- PLACEHOLDER, provider key missing';
    else if (followers !== undefined && followers !== null) line += '  <-- live read';
  } catch (e) {
    line += `ERROR ${e.message}`;
  }
  console.log(line);
}
process.exit(0);
