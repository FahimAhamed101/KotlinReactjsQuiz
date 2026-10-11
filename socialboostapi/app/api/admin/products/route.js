// GET /api/admin/products — what can be bought, and with what.
//
// The distinction that matters here: `coinsPrice` set means a Free (coins) product,
// `coinsPrice` null means a Premium product paid through Google Play. That single field
// is how the app decides whether to charge coins or open the Play sheet, so it is
// surfaced prominently rather than left for the reader to infer.

import { handle } from '@/lib/envelope';
import { requireAdmin } from '@/lib/adminAuth';
import { db } from '@/lib/db';
import { Order } from '@/lib/models';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  await requireAdmin(request);

  const products = await db.product.find({
    include: { productType: true },
    sort: { id: 'asc' },
  });

  const sold = await Order.aggregate([
    { $group: { _id: '$productId', orders: { $sum: 1 } } },
  ]);
  const soldMap = new Map(sold.map((s) => [s._id, s.orders]));

  const items = products.map((p) => ({
    id: p.id,
    oldId: p.oldId,
    actionCount: p.actionCount,
    coinsPrice: p.coinsPrice,
    price: p.price,
    billingProductId: p.billingProductId,
    productTypeId: p.productTypeId,
    productType: p.productType?.name ?? null,
    category: p.category,
    isActive: p.isActive,
    off: p.off,
    orders: soldMap.get(p.id) ?? 0,
    // Which payment rail the app will use for this row.
    tier: p.coinsPrice === null || p.coinsPrice === undefined ? 'Premium' : 'Free',
  }));

  return {
    items,
    totals: {
      products: items.length,
      active: items.filter((p) => p.isActive).length,
      free: items.filter((p) => p.tier === 'Free').length,
      premium: items.filter((p) => p.tier === 'Premium').length,
      // A Premium product with no Play product id can never be bought — the client would
      // ask Play for a product that does not exist. Worth flagging loudly.
      premium_without_billing_id: items.filter((p) => p.tier === 'Premium' && !p.billingProductId).length,
    },
  };
});
