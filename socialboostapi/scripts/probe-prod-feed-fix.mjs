// Verify the DEPLOYED feed, not the local one.
//
//   node --import ./scripts/register-esm-hook.mjs scripts/probe-prod-feed-fix.mjs <token> [baseUrl] [platform] [username]
//
// Uses the handset's own bearer token on purpose. Logging in here would call
// `issueToken()`, which revokes every existing token for the user (Laravel Sanctum
// single-session parity) and would sign the phone out — see scripts/restore-phone-session.mjs.
//
// The check: read this viewer's credited orders from the ledger (the CLI and the deployed
// build share one Atlas cluster), ask production for page 1 of the feed, and report any
// credited order that production still offers. A non-zero overlap is the "Could not
// verify" bug: the user repeats a task that has already been paid.

import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');

const [token, base = 'https://kotlin-reactjs-quiz-xi.vercel.app', platform = 'instagram', username = 'fahimahmed1000012'] =
  process.argv.slice(2);
if (!token) {
  console.error('usage: probe-prod-feed-fix.mjs <token> [baseUrl] [platform] [username]');
  process.exit(1);
}

const { buildSignatureHeaders } = await import('../lib/signature.js');
const { dbConnect } = await import('../lib/mongodb.js');
const db = (await import('../lib/db.js')).default;
await dbConnect();

const hash = crypto.createHash('sha256').update(process.env.HASH_VALUE || '').digest('hex');

// The server signs the PATHNAME only (no query string, no leading slash).
const pathname = '/api/v6/orders';
const query = `?page=1&username=${encodeURIComponent(username)}&platform=${platform}`;

const res = await fetch(base + pathname + query, {
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    hash,
    Authorization: `Bearer ${token}`,
    'X-App-Token': token,
    ...buildSignatureHeaders({ method: 'GET', path: pathname.replace(/^\/+/, ''), body: {} }),
  },
});
const body = await res.json().catch(() => ({}));

console.log(`GET ${base}${pathname}${query}`);
console.log(`  -> ${res.status}  success=${body.success}  ${body.message ? 'message="' + body.message + '"' : ''}`);
if (res.status !== 200 || !body.success) {
  console.log('  body:', JSON.stringify(body).slice(0, 400));
  process.exit(1);
}

const items = body.data?.items ?? [];
console.log(`  items=${items.length}  has_next=${body.data?.has_next ?? body.data?.hasNext}`);

// Cross-check against the ledger. `coins_histories.username` is the VIEWER.
const ledger = await db.coinsHistory.find({ where: { username: username.toLowerCase() }, limit: 500 });
const credited = new Set(ledger.filter((r) => r.orderId != null).map((r) => Number(r.orderId)));

let leaks = 0;
for (const it of items) {
  const id = Number(it.id);
  const paid = credited.has(id);
  if (paid) leaks++;
  console.log(
    `    order #${id} @${it.username} ${it.is_likes ? 'Like' : 'Follow'} reward=${it.reward_coins ?? it.rewardCoins}` +
      (paid ? '   <-- ALREADY PAID (LEAK)' : ''),
  );
}

console.log(`\nviewer @${username} has ${credited.size} credited order(s); PRODUCTION re-offers: ${leaks}`);
process.exit(leaks === 0 ? 0 : 2);
