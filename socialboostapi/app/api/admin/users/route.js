// GET /api/admin/users — the users list.
//
// The panel's core screen: who is on the platform, what they hold, and what they have
// done. Coin balances come from `users.coins`, which the app maintains on every
// earn/spend, so this is the same number the client sees.

import { handle } from '@/lib/envelope';
import { requireAdmin } from '@/lib/adminAuth';
import { db } from '@/lib/db';
import { listParams, listResult, searchOr } from '@/lib/adminQuery';
import { Order, CodeUnlock } from '@/lib/models';

export const dynamic = 'force-dynamic';

const SORTABLE = ['id', 'email', 'name', 'coins', 'status', 'createdAt', 'lastActivityAt'];

export const GET = handle(async (request) => {
  await requireAdmin(request);

  const { page, perPage, skip, search, orderBy } = listParams(request, {
    sortable: SORTABLE,
    defaultSort: 'id',
    defaultDir: 'desc',
  });

  const where = {};
  const or = searchOr(search, ['email', 'name']);
  if (or) Object.assign(where, or);

  const status = new URL(request.url).searchParams.get('status');
  if (status && ['Active', 'Suspended'].includes(status)) where.status = status;

  const total = await db.user.count({ where });

  const rows = await db.user.find({
    where,
    orderBy,
    skip,
    limit: perPage,
    // `password` and `adminPasswordHash` are `select: false` so they are absent by
    // default; the projection is explicit to make that visible at a glance.
    select: {
      id: true,
      email: true,
      name: true,
      coins: true,
      status: true,
      isAdmin: true,
      createdAt: true,
      lastActivityAt: true,
      lastPurchaseAt: true,
    },
  });

  // Per-user activity counts, batched into one aggregation each rather than one query
  // per row — a 25-row page would otherwise cost 50 round trips.
  const ids = rows.map((r) => r.id);
  const [orderCounts, unlockCounts] = await Promise.all([
    ids.length
      ? Order.aggregate([
          { $match: { userId: { $in: ids } } },
          { $group: { _id: '$userId', count: { $sum: 1 } } },
        ])
      : [],
    ids.length
      ? CodeUnlock.aggregate([
          { $match: { userId: { $in: ids } } },
          { $group: { _id: '$userId', count: { $sum: 1 }, spent: { $sum: '$coinsSpent' } } },
        ])
      : [],
  ]);

  const orderMap = new Map(orderCounts.map((r) => [r._id, r.count]));
  const unlockMap = new Map(unlockCounts.map((r) => [r._id, r]));

  // Note: no `linked_accounts` column. `accounts` has no `userId`, so any such count
  // would be structurally always zero — a column that looks like data but cannot vary.
  const items = rows.map((u) => ({
    ...u,
    orders_count: orderMap.get(u.id) ?? 0,
    unlocks_count: unlockMap.get(u.id)?.count ?? 0,
    coins_spent_on_codes: unlockMap.get(u.id)?.spent ?? 0,
  }));

  return listResult(items, { page, perPage, total });
});
