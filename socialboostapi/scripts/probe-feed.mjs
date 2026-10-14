// One-off: how slow is GET /v6/orders really, and what does it return?
// Run: node --import ./scripts/register-esm-hook.mjs scripts/probe-feed.mjs <baseUrl>
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, '..', '.env'));

const { buildSignatureHeaders } = await import('../lib/signature.js');
const { canonicalJson } = await import('../lib/signature.js');

const base = process.argv[2] || 'https://kotlin-reactjs-quiz-xi.vercel.app';
const hash = crypto.createHash('sha256').update(process.env.HASH_VALUE || '').digest('hex');

async function call(method, path, body, token) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    hash,
    ...buildSignatureHeaders({ method, path: path.split('?')[0].replace(/^\/+/, ''), body: body ?? {} }),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (token) headers['X-App-Token'] = token;

  const t0 = Date.now();
  const res = await fetch(base + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ms = Date.now() - t0;
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, ms, json, text };
}

console.log(`base: ${base}\n`);

const login = await call('POST', '/api/v6/login', {
  id: 'demo@ttboost.app',
  username: 'demo_user',
  device_name: 'probe',
});
console.log(`POST /api/v6/login  -> ${login.status}  ${login.ms}ms`);
const token =
  login.json?.data?.auth?.token ||
  login.json?.data?.token ||
  login.json?.data?.access_token ||
  login.json?.token ||
  null;
console.log(`  token: ${token ? token.slice(0, 24) + '…' : '(none)'}`);
if (!login.json?.success) console.log('  body:', login.text.slice(0, 300));

const t0 = Date.now();
const feed = await call('GET', '/api/v6/orders?page=1', null, token);
console.log(`\nGET /api/v6/orders  -> ${feed.status}  ${feed.ms}ms`);
if (feed.json) {
  const items = feed.json?.data?.items ?? feed.json?.items ?? [];
  console.log(`  success: ${feed.json.success}  items: ${items.length}`);
  for (const it of items.slice(0, 20)) {
    console.log(
      `    id=${it.id} user=${it.username} likes=${it.is_likes} type=${it.type} ` +
        `image=${(it.image || '').slice(0, 55)} url=${(it.url || '').slice(0, 45)}`,
    );
  }
  if (!feed.json.success) console.log('  error:', JSON.stringify(feed.json).slice(0, 400));
} else {
  console.log('  raw:', feed.text.slice(0, 400));
}
console.log(`\ntotal: ${Date.now() - t0}ms for the feed call`);
