// Re-keys the 29 boost SKUs to a hyphen-only scheme.
//
// Play Console refused `tt_follow_200` with "This Product ID has been deleted." — a deleted
// product ID can never be reused, for the lifetime of the app. We cannot know which of the
// other 28 were also created-then-deleted while exploring, so all of them move to a fresh
// namespace in one pass rather than discovering them one failure at a time.
//
// Hyphens rather than underscores: the same string is then valid as a Product ID *and* as a
// Purchase option ID (which forbids underscores), so there is no way to paste one into the
// wrong box. Nothing else in the app depends on the old `tt_` prefix — `isBoostProduct`
// tests list membership — so the catalogue and Constants.BOOST_PRODUCT_IDS are the only
// places that need the new strings.
//
// Idempotent: a row already carrying its new id is reported as unchanged.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
require('./load-env.cjs').loadEnv(resolve(here, '..', '.env'));
const { db } = await import('../lib/db.js');

const RENAME = {
  'tt_follow_200': 'boost-follow-200',
  'tt_follow_400': 'boost-follow-400',
  'tt_follow_900': 'boost-follow-900',
  'tt_follow_2000': 'boost-follow-2000',
  'tt_follow_4300': 'boost-follow-4300',
  'tt_follow_9000': 'boost-follow-9000',
  'tt_like_300': 'boost-like-300',
  'tt_like_600': 'boost-like-600',
  'tt_like_1300': 'boost-like-1300',
  'tt_like_2700': 'boost-like-2700',
  'tt_like_5600': 'boost-like-5600',
  'tt_like_11500': 'boost-like-11500',
  'tt_view_1000': 'boost-view-1000',
  'tt_view_3000': 'boost-view-3000',
  'tt_view_10000': 'boost-view-10000',
  'tt_view_25000': 'boost-view-25000',
  'tt_view_50000': 'boost-view-50000',
  'tt_share_300': 'boost-share-300',
  'tt_share_1000': 'boost-share-1000',
  'tt_share_3000': 'boost-share-3000',
  'tt_share_8000': 'boost-share-8000',
  'tt_share_15000': 'boost-share-15000',
  'tt_comment_200': 'boost-comment-200',
  'tt_comment_600': 'boost-comment-600',
  'tt_comment_1500': 'boost-comment-1500',
  'tt_comment_3500': 'boost-comment-3500',
  'tt_comment_7000': 'boost-comment-7000',
  'tt_coin_19_99': 'boost-coins-17000',
  'tt_coin_99_99': 'boost-coins-50000',
};

let renamed = 0;
let already = 0;
const missing = [];

for (const [oldId, newId] of Object.entries(RENAME)) {
  const row = await db.product.findOne({ where: { billingProductId: oldId } });
  if (row) {
    await db.product.update({ where: { id: row.id }, data: { billingProductId: newId } });
    renamed += 1;
    console.log(`  #${String(row.id).padEnd(3)} ${oldId}  ->  ${newId}`);
    continue;
  }
  const done = await db.product.findOne({ where: { billingProductId: newId } });
  if (done) {
    already += 1;
    console.log(`  #${String(done.id).padEnd(3)} ${newId}  (already migrated)`);
    continue;
  }
  missing.push(oldId);
}

console.log(`\nrenamed ${renamed}, already done ${already}`);
if (missing.length) console.log(`no row for: ${missing.join(', ')}`);

// Sanity: no boost row may keep an underscore-bearing id, because that string would be
// rejected in the Purchase option ID box on the next Play Console screen.
const all = await db.product.find({ where: {}, limit: 500 });
const bad = all.filter((p) => p.billingProductId && !p.billingProductId.includes('code_') && p.billingProductId.includes('_'));
console.log(bad.length ? `still underscore ids: ${bad.map((p) => p.billingProductId).join(', ')}` : 'all boost ids are hyphen-only');
process.exit(0);
