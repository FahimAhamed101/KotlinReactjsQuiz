// Settings accessors.
//
// Ported from App\Models\Setting + App\Models\Settings.
//
// The Laravel `settings` table is a key/value store and `Setting::getSettings()`
// returns a flat `{key: value}` map of *every* row — that map is what the client
// receives as `preferences`. Values are stored as strings and coerced on read.
//
// DEFAULTS below mirror SettingsSeeder. They are used when a key is absent so a
// fresh database still behaves like the seeded production one.

import db from './db';

export const DEFAULTS = {
  referral: 250,
  like: 3,
  follow: 5,
  welcomeBonus: 30,
  // The free daily claim. Next.js-native: the Laravel original has no daily bonus
  // (its `Spin` is a paid Google Play product), so the amount is a server-side setting
  // the client never sets or sees hardcoded.
  dailyBonus: 100,
  maxFullWelcomeBonusPer3Hours: 500,
  reducedWelcomeBonus: 50,
  maxReferralsPerUser: 5,
  premiumLikesOrderBonus: 0.2,
  premiumFollowOrderBonus: 0.5,
  FreeLikesOrderBonus: 0.0,
  FreeFollowOrderBonus: 0.0,
  premiumOrdersPerPage: 10,
  freeOrdersPerPage: 10,
  maxOrdersPerUser: 100,
  maxAccounts: 8,
  allowTestCard: 0,
  waitPerTask: 0,
  maxTaskTry: 2,
  freeOrderRateLimit: 8,
  paidOrderRateLimit: 24,
  loginRateLimit: 60,
  globalRateLimit: 300,
  timeServerRateLimit: 15,
  discountDurationTime: 30,
  tokenExpiresIn: 43200,
  pendingOrderExpiryMinutes: 120,
  maxPendingOrdersPerUser: 100,
  offer_display_time_in_minutes: 10,
  maxFreeOrdersInProgress: 500,
};

/** In-process cache so a request that reads ten settings hits the DB once. */
let cache = null;
let cacheAt = 0;
const CACHE_TTL_MS = 30_000;

/** All settings as a flat string map (the client's `preferences`). */
export async function allSettings({ fresh = false } = {}) {
  const now = Date.now();
  if (!fresh && cache && now - cacheAt < CACHE_TTL_MS) return cache;

  const rows = await db.setting.find();
  const map = {};
  for (const row of rows) map[row.key] = row.value;

  cache = map;
  cacheAt = now;
  return map;
}

/** Raw string value, falling back to the seeded default, then to null. */
export async function getSetting(key) {
  const map = await allSettings();
  if (map[key] !== undefined) return map[key];
  return DEFAULTS[key] !== undefined ? String(DEFAULTS[key]) : null;
}

/** Integer setting. Mirrors Settings::getInt(). */
export async function getInt(key, fallback = 0) {
  const raw = await getSetting(key);
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Float setting. Mirrors Settings::getFloat(). */
export async function getFloat(key, fallback = 0) {
  const raw = await getSetting(key);
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function invalidateSettingsCache() {
  cache = null;
  cacheAt = 0;
}
