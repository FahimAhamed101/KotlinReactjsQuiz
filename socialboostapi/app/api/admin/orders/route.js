// GET /api/admin/orders — every order across the platform.

import { handle } from '@/lib/envelope';
import { requireAdmin } from '@/lib/adminAuth';
import { db } from '@/lib/db';
import { listParams, listResult, searchOr } from '@/lib/adminQuery';

export const dynamic = 'force-dynamic';

const SORTABLE = ['id', 'status', 'type', 'priority', 'currentProgress', 'createdAt', 'username'];
// 'Cancelled' is the canonical spelling (Laravel's OrderStatus::Cancelled, which is
// also what the client sees). 'Canceled' only exists on rows written by an earlier
// build of this port, so filtering on either must match both.
const CANCELLED = ['Cancelled', 'Canceled'];
const STATUSES = ['Progress', 'InQueue', 'Pending', 'Completed', 'Cancelled', 'SmmPanel'];
const TYPES = ['Free', 'Premium', 'Special'];

export const GET = handle(async (request) => {
  await requireAdmin(request);

  const { page, perPage, skip, search, orderBy } = listParams(request, {
    sortable: SORTABLE,
    defaultSort: 'id',
    defaultDir: 'desc',
  });

  const sp = new URL(request.url).searchParams;

  const where = {};
  const status = sp.get('status');
  if (status) {
    if (CANCELLED.includes(status)) where.status = { in: CANCELLED };
    else if (STATUSES.includes(status)) where.status = status;
  }

  const type = sp.get('type');
  if (type && TYPES.includes(type)) where.type = type;

  const userId = parseInt(sp.get('user_id') ?? '', 10);
  if (Number.isFinite(userId)) where.userId = userId;

  const or = searchOr(search, ['username', 'url']);
  if (or) Object.assign(where, or);

  const [total, items] = await Promise.all([
    db.order.count({ where }),
    db.order.find({
      where,
      include: { product: true, user: true },
      orderBy,
      skip,
      limit: perPage,
    }),
  ]);

  return listResult(items, { page, perPage, total });
});
