// Undoes rename-boost-skus.mjs: puts the 29 boost SKUs back on their `tt_*` ids.
//
// Reverting restores the ids exactly as they were in the catalogue before the rename, so
// anything already created in Play Console under a `tt_*` id matches the app again. Note that
// `tt_follow_200` is the id Play reported as deleted — if that product has to be recreated,
// its row will need a different id, not this one.
//
// Idempotent: a row already carrying its old id is reported as unchanged.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
require('./load-env.cjs').loadEnv(resolve(here, '..', '.env'));
const { db } = await import('../lib/db.js');

const RENAME = {
  'boost-follow-200': 'tt_follow_200',
  'boost-follow-400': 'tt_follow_400',
  'boost-follow-900': 'tt_follow_900',
  'boost-follow-2000': 'tt_follow_2000',
  'boost-follow-4300': 'tt_follow_4300',
  'boost-follow-9000': 'tt_follow_9000',
  'boost-like-300': 'tt_like_300',
  'boost-like-600': 'tt_like_600',
  'boost-like-1300': 'tt_like_1300',
  'boost-like-2700': 'tt_like_2700',
  'boost-like-5600': 'tt_like_5600',
  'boost-like-11500': 'tt_like_11500',
  'boost-view-1000': 'tt_view_1000',
  'boost-view-3000': 'tt_view_3000',
  'boost-view-10000': 'tt_view_10000',
  'boost-view-25000': 'tt_view_25000',
  'boost-view-50000': 'tt_view_50000',
  'boost-share-300': 'tt_share_300',
  'boost-share-1000': 'tt_share_1000',
  'boost-share-3000': 'tt_share_3000',
  'boost-share-8000': 'tt_share_8000',
  'boost-share-15000': 'tt_share_15000',
  'boost-comment-200': 'tt_comment_200',
  'boost-comment-600': 'tt_comment_600',
  'boost-comment-1500': 'tt_comment_1500',
  'boost-comment-3500': 'tt_comment_3500',
  'boost-comment-7000': 'tt_comment_7000',
  'boost-coins-17000': 'tt_coin_19_99',
  'boost-coins-50000': 'tt_coin_99_99',
};

let reverted = 0;
let already = 0;
const missing = [];

for (const [newId, oldId] of Object.entries(RENAME)) {
  const row = await db.product.findOne({ where: { billingProductId: newId } });
  if (row) {
    await db.product.update({ where: { id: row.id }, data: { billingProductId: oldId } });
    reverted += 1;
    console.log(`  #${String(row.id).padEnd(3)} ${newId}  ->  ${oldId}`);
    continue;
  }
  const done = await db.product.findOne({ where: { billingProductId: oldId } });
  if (done) {
    already += 1;
    console.log(`  #${String(done.id).padEnd(3)} ${oldId}  (already reverted)`);
    continue;
  }
  missing.push(newId);
}

console.log(`\nreverted ${reverted}, already reverted ${already}`);
if (missing.length) console.log(`no row for: ${missing.join(', ')}`);
process.exit(0);
