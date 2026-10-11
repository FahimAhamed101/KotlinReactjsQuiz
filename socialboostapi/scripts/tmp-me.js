const crypto = require('crypto');
const { signatureHeaders } = require('./signing.cjs');
const BASE = 'http://127.0.0.1:4000';
const HASH = crypto.createHash('sha256').update('nesyou is the best').digest('hex');
async function call(method, path, body, token, extra = {}) {
  const headers = { Accept: 'application/json', ...(await signatureHeaders(method, path, body)), ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: JSON.parse(await res.text()) };
}
(async () => {
  const creds = { device_name: 'me-probe', id: 'demo_user@ttboost.app', username: 'demo_user' };
  const r = await call('POST', '/api/v6/login', creds, null, { hash: HASH });
  const token = r.json.data?.auth?.token;
  console.log('login ->', r.status, 'user.coins =', r.json.data?.user?.coins, 'id =', r.json.data?.user?.id);
  const me = await call('GET', '/api/v6/me', null, token);
  console.log('/v6/me ->', me.status, 'coins =', me.json.data?.user?.coins);
  process.exit(0);
})();
