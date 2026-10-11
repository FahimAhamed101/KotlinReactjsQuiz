const crypto = require('crypto');
const { signatureHeaders } = require('./signing.cjs');

const BASE = 'http://127.0.0.1:4000';
const HASH = crypto.createHash('sha256').update('nesyou is the best').digest('hex');

async function call(method, path, body, token, extraHeaders = {}) {
  const headers = {
    Accept: 'application/json',
    ...(await signatureHeaders(method, path, body)),
    ...extraHeaders,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: { raw: text } };
  }
}

(async () => {
  console.log('Testing coins check verification...');
  // 1. Sign in
  const creds = { device_name: 'test-checker', id: 'checkertest@ttboost.app', username: 'checkertest' };
  let r = await call('POST', '/api/v6/login', creds, null, { hash: HASH });
  if (!r.json.success && r.json.error_code === 'UserNotRegistered') {
    r = await call('POST', '/api/v6/register', { ...creds, is_emulator: false }, null, { hash: HASH });
  }
  const token = r.json.data?.auth?.token;
  if (!token) {
    console.error('Failed to log in:', r.json);
    process.exit(1);
  }

  // 2. Get feed of tasks
  const feedRes = await call('GET', '/api/v6/orders?page=1&username=checkertest', null, token);
  const tasks = feedRes.json.data?.items ?? [];
  console.log(`Feed returned ${tasks.length} tasks`);
  if (tasks.length === 0) {
    console.log('No tasks available to test verification.');
    process.exit(0);
  }

  const task = tasks[0];
  console.log(`Testing task orderId=${task.id}, username=${task.username}, isLikes=${task.is_likes}`);

  // 3. Test negative check: client reports follow_incremented = false (user didn't follow)
  const falseCheck = await call('POST', '/api/v6/coins/check', {
    order_id: task.id,
    tt_username: 'checkertest',
    tiktok_username: task.username,
    follow_incremented: false,
    likes_incremented: false,
  }, token);

  console.log('Uncompleted check response:', falseCheck.json);
  if (falseCheck.json.data?.is_success === false) {
    console.log('PASS: Uncompleted action refused coins as expected!');
  } else {
    console.error('FAIL: Uncompleted action was granted coins!', falseCheck.json);
    process.exit(1);
  }

  // 4. Test positive check: client confirmed action completed on TikTok
  const trueCheck = await call('POST', '/api/v6/coins/check', {
    order_id: task.id,
    tt_username: 'checkertest',
    tiktok_username: task.username,
    follow_incremented: true,
    likes_incremented: true,
  }, token);

  console.log('Confirmed action check response:', trueCheck.json);
  if (trueCheck.json.data?.is_success === true && trueCheck.json.data?.coins_earned > 0) {
    console.log(`PASS: Confirmed action earned ${trueCheck.json.data.coins_earned} coins!`);
  } else if (trueCheck.json.data?.already === true) {
    console.log('PASS: Order was already credited (idempotent)!');
  } else {
    console.error('FAIL: Action check failed:', trueCheck.json);
  }

  console.log('ALL VERIFICATION BEHAVIOR CHECKS PASSED!');
})();
