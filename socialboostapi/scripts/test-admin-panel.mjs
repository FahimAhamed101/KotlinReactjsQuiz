// Drive a real browser through the admin panel and assert it renders real data.
//
// Run with:
//   node scripts/test-admin-panel.mjs
//
// Why a browser: the panel's screens are client components, so the server HTML contains
// the shell and a loading state — fetching the pages with curl proves they compile, not
// that they work. Only a browser runs the RTK Query fetch and paints the result.
//
// The assertions compare the DOM against values fetched from the live API in the same
// page, rather than against hard-coded numbers. A hard-coded `17` would pass on a stale
// database and start failing the moment a code is added, which trains you to ignore it.
//
// Two traps this file has already fallen into, both worth remembering:
//   * `page.content()` returns *serialized HTML*, so a title containing `&` reads back as
//     `&amp;` and a plain `includes(title)` fails even though the page is correct. Compare
//     against `innerText` (decoded) when you mean "what the user sees".
//   * `fill()` before React hydrates lands on the server-rendered input, and hydration then
//     resets it to the component's (empty) state. The POST goes out with no body and the
//     API answers 422 — which looks like an API bug and is not. Use `fillStable()`.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');

const BASE = process.env.PANEL_BASE || 'http://127.0.0.1:4000';
const CHROME =
  process.env.CHROME_PATH ||
  'C:/Users/Admin/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

const EMAIL = process.env.ADMIN_SEED_EMAIL || 'admin@ttboost.app';
const PASSWORD = process.env.ADMIN_SEED_PASSWORD || 'admin12345';

const SHOTS = join(ROOT, 'screenshots');
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
let checks = 0;

function ok(label, condition, detail = '') {
  checks++;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Read the `.stat` tiles as a {label: value} map. */
async function readStats(page) {
  return page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll('.stat')) {
      const label = el.querySelector('.stat-label')?.textContent?.trim();
      const value = el.querySelector('.stat-value')?.textContent?.trim();
      if (label) out[label] = value;
    }
    return out;
  });
}

/** Fetch an admin endpoint from inside the page so it carries the session cookie. */
async function api(page, path) {
  return page.evaluate(async (p) => {
    const res = await fetch(`/api/admin${p}`);
    return { status: res.status, body: await res.json() };
  }, path);
}

/**
 * Set a controlled input's value, retrying until it survives a tick.
 *
 * React hydration replaces the DOM value with the component state, so a `fill()` that
 * lands before hydration silently empties the field. Retrying until the value sticks is
 * deterministic where `waitForTimeout(500)` is a guess.
 */
async function fillStable(page, selector, value) {
  await page.waitForSelector(selector, { state: 'visible', timeout: 20000 });
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.fill(selector, value);
    if ((await page.inputValue(selector)) === value) {
      await page.waitForTimeout(50); // give hydration a chance to wipe it
      if ((await page.inputValue(selector)) === value) return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`input ${selector} would not hold its value (hydration race?)`);
}

/** The rendered text of a table row, whitespace-normalised. */
async function rowText(row) {
  return (await row.innerText()).replace(/\s+/g, ' ').trim();
}

const n = (v) => Number(v);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

// A browser logs a console error for every failed fetch, and this run deliberately makes
// one (the wrong password). Recording the URL — rather than regexing the console text —
// is what lets the final check say *which* request failed instead of "something 401'd".
const failedResponses = [];
page.on('response', (r) => {
  if (r.status() >= 400) {
    failedResponses.push({ status: r.status(), method: r.request().method(), url: r.url() });
  }
});

try {
  // ---------------------------------------------------------------
  console.log('\n[1] the guard: signed out must not reach the panel');
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/admin/login', { timeout: 15000 }).catch(() => {});
  ok('signed-out /admin lands on the login page', page.url().includes('/admin/login'), page.url());
  ok('the login form is rendered', await page.locator('input#password').isVisible());

  // ---------------------------------------------------------------
  console.log('\n[2] a wrong password is refused, in the UI');
  await fillStable(page, 'input#email', EMAIL);
  await fillStable(page, 'input#password', 'definitely-not-the-password');
  await page.click('button[type=submit]');
  await page.waitForSelector('.banner-error', { timeout: 15000 });
  const wrongMsg = (await page.locator('.banner-error').textContent())?.trim();
  ok('an error banner appears', !!wrongMsg, wrongMsg);
  ok('it does not leak whether the account exists', !/no such|not found|unknown user/i.test(wrongMsg ?? ''), wrongMsg);
  ok('still on the login page', page.url().includes('/admin/login'));

  // ---------------------------------------------------------------
  console.log('\n[3] the correct password signs in');
  await fillStable(page, 'input#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/admin`, { timeout: 20000 });
  await page.waitForSelector('.stat', { timeout: 20000 });
  ok('redirected to the dashboard', page.url().endsWith('/admin'), page.url());

  // ---------------------------------------------------------------
  console.log('\n[4] dashboard tiles match the API');
  const statsApi = (await api(page, '/stats')).body.data;
  const tiles = await readStats(page);

  const fmt = (v) => Number(v).toLocaleString('en-US');
  ok('users tile matches /stats', tiles.Users === fmt(statsApi.users.total), `dom="${tiles.Users}" api=${statsApi.users.total}`);
  ok(
    'coins-in-circulation tile matches /stats',
    tiles['Coins in circulation'] === fmt(statsApi.economy.coins_in_circulation),
    `dom="${tiles['Coins in circulation']}" api=${statsApi.economy.coins_in_circulation}`,
  );
  ok('orders tile matches /stats', tiles.Orders === fmt(statsApi.orders.total), `dom="${tiles.Orders}" api=${statsApi.orders.total}`);
  ok(
    'codes-unlocked tile matches /stats',
    tiles['Codes unlocked'] === fmt(statsApi.catalogue.unlocks),
    `dom="${tiles['Codes unlocked']}" api=${statsApi.catalogue.unlocks}`,
  );
  await page.screenshot({ path: join(SHOTS, 'admin-01-dashboard.png'), fullPage: true });

  // ---------------------------------------------------------------
  console.log('\n[5] users list');
  await page.click('a[href="/admin/users"]');
  await page.waitForSelector('table tbody tr', { timeout: 20000 });

  const usersApi = (await api(page, '/users?page=1&per_page=25')).body.data;
  const userRows = await page.locator('table tbody tr').count();
  ok('row count matches the API page size', userRows === usersApi.items.length, `dom=${userRows} api=${usersApi.items.length}`);
  ok('the pager reports the API total', (await page.locator('.pager').textContent()).includes(fmt(usersApi.meta.total)), await page.locator('.pager').textContent());

  const demoApi = (await api(page, '/users/2')).body.data;
  const demoRow = page.locator('table tbody tr', { hasText: demoApi.user.email }).first();
  ok(
    `the demo user's balance is rendered (${fmt(demoApi.user.coins)})`,
    (await rowText(demoRow)).includes(fmt(demoApi.user.coins)),
    (await rowText(demoRow)).slice(0, 120),
  );
  await page.screenshot({ path: join(SHOTS, 'admin-02-users.png'), fullPage: true });

  // ---------------------------------------------------------------
  console.log('\n[6] search filters the list');
  await fillStable(page, 'input.search', demoApi.user.email);
  await page.waitForFunction(
    (needle) => document.querySelectorAll('table tbody tr').length > 0 &&
      [...document.querySelectorAll('table tbody tr')].every((tr) => tr.textContent.includes(needle)),
    demoApi.user.email,
    { timeout: 20000 },
  );
  const filtered = await page.locator('table tbody tr').count();
  ok('search narrows the table to matching rows', filtered >= 1 && filtered <= usersApi.items.length, `rows=${filtered}`);
  await page.fill('input.search', '');

  // ---------------------------------------------------------------
  console.log('\n[7] user detail');
  await page.goto(`${BASE}/admin/users/2`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.stat', { timeout: 20000 });
  const detailTiles = await readStats(page);
  ok('balance tile matches the API', detailTiles['Coin balance'] === fmt(demoApi.user.coins), `dom="${detailTiles['Coin balance']}" api=${demoApi.user.coins}`);
  ok('the page names the user', (await page.locator('h1').innerText()).includes(demoApi.user.name ?? demoApi.user.email));
  ok('the code-unlock section is present', (await page.locator('main, body').first().innerText()).includes('Code unlocks'));

  // The panel renders a red banner whenever a balance is not explained by the ledger. On
  // seeded demo data that must never fire: the seeder credits the opening balance to the
  // ledger, and `coins` is insert-only so a re-seed cannot strand a spent balance.
  const banners = await page.locator('.banner-error').count();
  ok(
    'the ledger reconciles with the balance (no drift banner)',
    demoApi.summary.balance_drift === 0 && banners === 0,
    `api drift=${demoApi.summary.balance_drift} banners=${banners}`,
  );
  await page.screenshot({ path: join(SHOTS, 'admin-03-user-detail.png'), fullPage: true });

  // ---------------------------------------------------------------
  console.log('\n[8] codes');
  await page.goto(`${BASE}/admin/codes`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('table tbody tr', { timeout: 20000 });
  const codesApi = (await api(page, '/codes')).body.data;
  const codeRows = await page.locator('table tbody tr').count();
  ok('one row per code', codeRows === codesApi.items.length, `dom=${codeRows} api=${codesApi.items.length}`);

  const sold = codesApi.items.find((c) => c.unlocks > 0);
  if (sold) {
    const soldRow = page.locator('table tbody tr', { hasText: sold.title }).first();
    ok(`a sold code is listed by title (${sold.title})`, (await rowText(soldRow)).includes(sold.title));
    // Unlocks is the 4th column; compare the cell, not "does the row contain the digit",
    // which would pass on the price or the date by accident.
    const cells = await soldRow.locator('td').allInnerTexts();
    ok(
      `its Unlocks column matches the API (${sold.unlocks})`,
      n(cells[3].trim()) === sold.unlocks,
      `dom="${cells[3]?.trim()}" api=${sold.unlocks}`,
    );
  } else {
    ok('a sold code exists to check', false, 'no code has unlocks > 0 — is the seed stale?');
  }
  await page.screenshot({ path: join(SHOTS, 'admin-04-codes.png'), fullPage: true });

  // ---------------------------------------------------------------
  console.log('\n[9] products');
  await page.goto(`${BASE}/admin/products`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('table tbody tr', { timeout: 20000 });
  const productsApi = (await api(page, '/products')).body.data;
  const productRows = await page.locator('table tbody tr').count();
  ok('one row per product', productRows === productsApi.items.length, `dom=${productRows} api=${productsApi.items.length}`);
  const premium = productsApi.items.find((p) => p.billingProductId);
  const productsText = await page.locator('table').innerText();
  ok(`a Play product id is shown (${premium?.billingProductId})`, productsText.includes(premium?.billingProductId ?? 'x'));
  ok('the Free/Premium rail is labelled', productsText.includes('Premium') && productsText.includes('Free'));
  await page.screenshot({ path: join(SHOTS, 'admin-05-products.png'), fullPage: true });

  // ---------------------------------------------------------------
  console.log('\n[10] orders + ledger render rows');
  await page.goto(`${BASE}/admin/orders`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('table tbody tr', { timeout: 20000 });
  const ordersApi = (await api(page, '/orders?page=1&per_page=25')).body.data;
  ok('order rows match the API', (await page.locator('table tbody tr').count()) === ordersApi.items.length);
  await page.screenshot({ path: join(SHOTS, 'admin-06-orders.png'), fullPage: true });

  await page.goto(`${BASE}/admin/coins`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('table tbody tr', { timeout: 20000 });
  const coinsApi = (await api(page, '/coins?page=1&per_page=25')).body.data;
  ok('ledger rows match the API', (await page.locator('table tbody tr').count()) === coinsApi.items.length);
  await page.screenshot({ path: join(SHOTS, 'admin-07-coins.png'), fullPage: true });

  // ---------------------------------------------------------------
  console.log('\n[11] signing out revokes access');
  await page.click('button:has-text("Sign out")');
  await page.waitForURL('**/admin/login', { timeout: 20000 });
  ok('signing out returns to the login page', page.url().includes('/admin/login'));
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL('**/admin/login', { timeout: 15000 }).catch(() => {});
  ok('the panel is unreachable again', page.url().includes('/admin/login'), page.url());

  // ---------------------------------------------------------------
  console.log('\n[12] no unexpected console errors');
  // The only failed requests this run should make are the favicon 404 and the deliberate
  // wrong-password 401. Anything else is a real defect.
  const unexpected = failedResponses.filter(
    (r) => !/\/favicon\.ico$/.test(r.url) && !(r.status === 401 && /\/api\/admin\/login$/.test(r.url)),
  );
  ok(
    'every failed request is an expected one',
    unexpected.length === 0,
    unexpected.map((r) => `${r.status} ${r.method} ${r.url}`).join(' | '),
  );
  const wrongPassword401 = failedResponses.some((r) => r.status === 401 && /\/api\/admin\/login$/.test(r.url));
  ok('the wrong-password attempt did return 401', wrongPassword401);

  // Network failures are already fully accounted for by the response check above, so this
  // only needs to cover what a response status cannot: uncaught exceptions in the page.
  const pageErrors = consoleErrors.filter((e) => !/Failed to load resource/i.test(e));
  ok('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log(`\n${checks - failures}/${checks} checks passed`);
console.log(failures === 0 ? 'ADMIN PANEL OK' : `${failures} FAILURE(S)`);
console.log(`screenshots: ${SHOTS}`);
process.exit(failures === 0 ? 0 : 1);
