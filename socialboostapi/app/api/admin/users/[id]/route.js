// GET /api/admin/users/{id} — one user with their activity.
//
// The detail screen answers "what has this account actually been doing": recent orders,
// the coins ledger, which codebases they unlocked, and any Google Play payments.

import { handle } from '@/lib/envelope';
import { requireAdmin } from '@/lib/adminAuth';
import { ApiException } from '@/lib/errors';
import { db } from '@/lib/db';
import { CoinsHistory, Order, Payment } from '@/lib/models';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request, { params }) => {
  await requireAdmin(request);

  const id = Number(params?.id);
  if (!Number.isFinite(id)) {
    throw new ApiException('MissingArgument', 'A numeric user id is required.');
  }

  const user = await db.user.findOne({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      coins: true,
      status: true,
      isAdmin: true,
      createdAt: true,
      updatedAt: true,
      lastActivityAt: true,
      lastPurchaseAt: true,
      lastPremiumPurchaseAt: true,
    },
  });

  if (!user) throw new ApiException('UserNotFound', 'User not found.', 404);

  const [orders, ledger, unlocks, counts, gained, lost, orderIds] = await Promise.all([
    db.order.find({
      where: { userId: id },
      include: { product: true },
      sort: { id: 'desc' },
      limit: 25,
    }),
    db.coinsHistory.find({ where: { userId: id }, sort: { id: 'desc' }, limit: 25 }),
    db.codeUnlock.find({ where: { userId: id }, include: { code: true }, sort: { id: 'desc' } }),
    Promise.all([
      db.order.count({ where: { userId: id } }),
      db.coinsHistory.count({ where: { userId: id } }),
      db.codeUnlock.count({ where: { userId: id } }),
    ]),
    // Totals come from the ledger itself rather than the cached `user.coins` column, so
    // the screen can show both and any disagreement is visible instead of hidden.
    CoinsHistory.aggregate([{ $match: { userId: id } }, { $group: { _id: null, t: { $sum: '$gain' } } }]),
    CoinsHistory.aggregate([{ $match: { userId: id } }, { $group: { _id: null, t: { $sum: '$lost' } } }]),
    Order.find({ userId: id }).select('id').lean(),
  ]);

  // Payments attach to an order, not a user, so the user's orders have to be resolved
  // first. Bounded by the same 25 most recent orders the screen shows.
  const recentOrderIds = orders.map((o) => o.id);
  const payments = recentOrderIds.length
    ? await Payment.find({ orderId: { $in: recentOrderIds } }).sort({ id: -1 }).lean()
    : [];

  const [orderCount, ledgerCount, unlockCount] = counts;
  const coinsGained = gained[0]?.t ?? 0;
  const coinsSpent = lost[0]?.t ?? 0;

  return {
    user,
    summary: {
      orders: orderCount,
      ledger_rows: ledgerCount,
      unlocks: unlockCount,
      total_orders_ever: orderIds.length,
      coins_gained: coinsGained,
      coins_spent: coinsSpent,
      // Non-zero means the stored balance no longer matches the ledger. Worth surfacing:
      // the app maintains `coins` on every earn/spend, so drift implies a missed write.
      balance_drift: user.coins - (coinsGained - coinsSpent),
    },
    orders,
    ledger,
    unlocks,
    payments,
  };
});
