// GET /api/admin/codes — the source-code catalogue and how it sells.

import { handle } from '@/lib/envelope';
import { requireAdmin } from '@/lib/adminAuth';
import { Code, CodeUnlock } from '@/lib/models';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  await requireAdmin(request);

  const [codes, unlockStats] = await Promise.all([
    Code.find().sort({ coinsPrice: 1 }).lean(),
    CodeUnlock.aggregate([
      {
        $group: {
          _id: '$codeId',
          unlocks: { $sum: 1 },
          coins_collected: { $sum: '$coinsSpent' },
        },
      },
    ]),
  ]);

  const byCode = new Map(unlockStats.map((s) => [s._id, s]));

  // Most recent unlock per code, so the screen can show whether a title is still selling
  // or went quiet months ago.
  const latest = await CodeUnlock.aggregate([
    { $group: { _id: '$codeId', lastAt: { $max: '$createdAt' } } },
  ]);
  const lastMap = new Map(latest.map((s) => [s._id, s.lastAt]));

  const items = codes.map((c) => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
    coinsPrice: c.coinsPrice,
    isActive: c.isActive,
    createdAt: c.createdAt,
    unlocks: byCode.get(c.id)?.unlocks ?? 0,
    coins_collected: byCode.get(c.id)?.coins_collected ?? 0,
    last_unlocked_at: lastMap.get(c.id) ?? null,
  }));

  const totalUnlocks = items.reduce((n, c) => n + c.unlocks, 0);
  const totalCoins = items.reduce((n, c) => n + c.coins_collected, 0);
  const neverSold = items.filter((c) => c.unlocks === 0).length;

  return {
    items,
    totals: {
      codes: items.length,
      active: items.filter((c) => c.isActive).length,
      unlocks: totalUnlocks,
      coins_collected: totalCoins,
      never_sold: neverSold,
      cheapest: items.length ? Math.min(...items.map((c) => c.coinsPrice)) : 0,
      dearest: items.length ? Math.max(...items.map((c) => c.coinsPrice)) : 0,
    },
  };
});
