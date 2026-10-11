// GET /api/v6/me/discount
//
// Ported from ProductController::discount. Returns the single discount product that
// the offer system promotes. The Laravel version hardcodes `tg_follow_9_99_discount`;
// the port uses the seeded discount product so the id and availability stay correct.

import { handle, success } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { err } from '@/lib/errors';
import db from '@/lib/db';
import { productResource } from '@/lib/resources';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  await guard(request, {}, { signature: true });

  const product = await db.product.findOne({
    where: { billingProductId: 'tt_follow_9_99_discount', isActive: true },
  });
  if (!product) throw err.unauthorized('Product not found.');

  return success(productResource(product));
});
