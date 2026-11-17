// Adds Google Play (card) tiers for the three video families.
//
// Views, Shares and Comments shipped coin-only, so the Store had no "PAY WITH GOOGLE PLAY"
// section for them at all — a buyer with no coins could not buy a view at any price. The
// order service needs nothing new: `isFree` is `coinsPrice !== null`, so a row with a null
// coinsPrice becomes a Premium order and `isPostAction('view')` already anchors it to the
// post exactly as the coin tiers do. Only the catalogue rows were missing.
//
// Card tiers start far above the coin tiers' 10 units because Play's minimum price is
// ~$0.99: nobody can sell 30 coins' worth of views for $0.03. Each tier is priced at or
// just under the coin equivalent so the two sections cannot contradict each other.
//
// Idempotent: re-running updates the price/active flag of an existing row instead of
// inserting a duplicate, so a mistake is fixed by editing the table and running again.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
require('./load-env.cjs').loadEnv(resolve(here, '..', '.env'));
const { db } = await import('../lib/db.js');

const TYPE = { Shares: 5, Comments: 6, Views: 7 };

// [productTypeId, actionCount, price, billingProductId]
const SPECS = [
  [TYPE.Views, 1000, '$2.99', 'tt_view_1000'],
  [TYPE.Views, 3000, '$7.99', 'tt_view_3000'],
  [TYPE.Views, 10000, '$19.99', 'tt_view_10000'],
  [TYPE.Views, 25000, '$39.99', 'tt_view_25000'],
  [TYPE.Views, 50000, '$79.99', 'tt_view_50000'],

  [TYPE.Shares, 300, '$2.99', 'tt_share_300'],
  [TYPE.Shares, 1000, '$7.99', 'tt_share_1000'],
  [TYPE.Shares, 3000, '$19.99', 'tt_share_3000'],
  [TYPE.Shares, 8000, '$39.99', 'tt_share_8000'],
  [TYPE.Shares, 15000, '$79.99', 'tt_share_15000'],

  [TYPE.Comments, 200, '$2.99', 'tt_comment_200'],
  [TYPE.Comments, 600, '$7.99', 'tt_comment_600'],
  [TYPE.Comments, 1500, '$19.99', 'tt_comment_1500'],
  [TYPE.Comments, 3500, '$39.99', 'tt_comment_3500'],
  [TYPE.Comments, 7000, '$79.99', 'tt_comment_7000'],
];

const nameOf = { [TYPE.Views]: 'Views', [TYPE.Shares]: 'Shares', [TYPE.Comments]: 'Comments' };
let created = 0;
let updated = 0;

for (const [productTypeId, actionCount, price, billingProductId] of SPECS) {
  const existing = await db.product.findOne({
    where: { productTypeId, actionCount, billingProductId },
  });

  if (existing) {
    await db.product.update({
      where: { id: existing.id },
      data: { price, coinsPrice: null, isActive: true, category: 1, off: null },
    });
    updated += 1;
    console.log(`  = #${existing.id} ${nameOf[productTypeId]} +${actionCount} ${price} (${billingProductId})`);
  } else {
    const row = await db.product.create({
      data: {
        actionCount,
        productTypeId,
        price,
        coinsPrice: null,
        billingProductId,
        isActive: true,
        category: 1,
        off: null,
      },
    });
    created += 1;
    console.log(`  + #${row.id} ${nameOf[productTypeId]} +${actionCount} ${price} (${billingProductId})`);
  }
}

console.log(`\ncreated ${created}, updated ${updated}`);
process.exit(0);
