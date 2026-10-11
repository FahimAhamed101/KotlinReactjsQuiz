// GET /api/admin/stats — the dashboard tiles.
//
// This route reads the Mongoose models directly rather than going through the Prisma
// facade. That is deliberate, not an oversight: the facade implements only the Prisma
// surface the mobile app's contract needs, which excludes `aggregate`. Summing coins in
// JavaScript would mean loading every user to add up one number. Admin-only analytics
// are the right place to use the driver's own aggregation.

import { handle } from '@/lib/envelope';
import { requireAdmin } from '@/lib/adminAuth';
import { User, Order, Code, CodeUnlock, Product, Account, CoinsHistory } from '@/lib/models';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  await requireAdmin(request);

  const [
    users,
    admins,
    suspended,
    orders,
    ordersProgress,
    ordersPending,
    ordersCompleted,
    ordersCanceled,
    codes,
    unlocks,
    products,
    accounts,
    ledgerRows,
    coinSum,
    earned,
    spent,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isAdmin: true }),
    User.countDocuments({ status: 'Suspended' }),
    Order.countDocuments(),
    Order.countDocuments({ status: 'Progress' }),
    Order.countDocuments({ status: 'Pending' }),
    Order.countDocuments({ status: 'Completed' }),
    // Both spellings: Laravel wrote 'Cancelled', an earlier build of this port
    // wrote 'Canceled'. Counting only one hides half the cancelled orders.
    Order.countDocuments({ status: { $in: ['Cancelled', 'Canceled'] } }),
    Code.countDocuments(),
    CodeUnlock.countDocuments(),
    Product.countDocuments({ isActive: true }),
    Account.countDocuments(),
    CoinsHistory.countDocuments(),
    User.aggregate([{ $group: { _id: null, total: { $sum: '$coins' } } }]),
    CoinsHistory.aggregate([{ $group: { _id: null, total: { $sum: '$gain' } } }]),
    CoinsHistory.aggregate([{ $group: { _id: null, total: { $sum: '$lost' } } }]),
  ]);

  return {
    users: { total: users, admins, suspended, accounts },
    orders: {
      total: orders,
      progress: ordersProgress,
      pending: ordersPending,
      completed: ordersCompleted,
      canceled: ordersCanceled,
    },
    catalogue: { codes, products, unlocks },
    economy: {
      coins_in_circulation: coinSum[0]?.total ?? 0,
      coins_earned: earned[0]?.total ?? 0,
      coins_spent: spent[0]?.total ?? 0,
      ledger_rows: ledgerRows,
    },
  };
});
