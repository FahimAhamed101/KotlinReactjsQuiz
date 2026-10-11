// GET /api/v6/products
//
// Ported from ProductController::index — active products in the General category.

import { handle } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { productResource } from '@/lib/resources';
import { ProductCategory } from '@/lib/constants';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  await guard(request, {}, { signature: true });

  const products = await db.product.find({
    where: { isActive: true, category: ProductCategory.General },
    include: { productType: true },
    sort: { id: 'asc' },
  });

  return products.map(productResource);
});
