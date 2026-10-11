// GET /api/v6/me/orders
//
// Ported from V4OrderController::orders (the controller v5/v6 resolves to).
// Returns the V4 resource — no reactivation fields.

import { handle, paginate } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { orderResource } from '@/lib/resources';
import { pageOf } from '@/lib/validate';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

const PER_PAGE = 30;

export const GET = handle(async (request) => {
  const user = await guard(request, {}, { signature: true });
  const page = pageOf(request, 1);

  const where = { userId: user.id, deletedAt: null };

  const [rows, total] = await Promise.all([
    db.order.find({
      where,
      include: { product: { include: { productType: true } }, user: true },
      sort: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      limit: PER_PAGE,
    }),
    db.order.count({ where }),
  ]);

  return paginate(rows.map((o) => orderResource(o, { v4: true })), {
    page,
    perPage: PER_PAGE,
    total,
  });
});
