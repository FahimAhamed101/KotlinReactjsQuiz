// Signed lookup probe. Run:
//   node --import ./scripts/register-esm-hook.mjs scripts/test-lookup.mjs <baseUrl> <username>
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadEnv } = require('./load-env.cjs');
loadEnv('.env');
const { buildSignatureHeaders } = await import('../lib/signature.js');

const base = process.argv[2] || 'http://127.0.0.1:4000';
const username = process.argv[3] || 'fahim1000011';
const path = `/api/v6/lookup/tiktok/${encodeURIComponent(username)}`;

const res = await fetch(base + path, {
  headers: {
    Accept: 'application/json',
    ...buildSignatureHeaders({ method: 'GET', path: path.replace(/^\/+/, ''), body: {} }),
  },
});

const text = await res.text();
console.log(`GET ${base}${path}`);
console.log(`status=${res.status}  bytes=${text.length}`);
console.log(text.slice(0, 900));
process.exit(0);
