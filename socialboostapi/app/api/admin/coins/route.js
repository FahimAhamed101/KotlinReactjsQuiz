// GET /api/admin/coins — the coins ledger across every user.
//
// This is the audit trail for the economy: every earn and spend writes a row, so this
// screen is what makes a balance explainable rather than a number you have to trust.

import { handle } from '@/lib/envelope';
import { requireAdmin } from '@/lib/adminAuth';
import { db } from '@/lib/db';
import { listParams, listResult, searchOr } from '@/lib/adminQuery';
import { CoinsHistory } from '@/lib/models';

export const dynamic = 'force-dynamic';

const SORTABLE = ['id', 'userId', 'type', 'gain', 'lost', 'createdAt'];

// Mirrors the CoinHistoryType values the services write.
const TYPES = [
  'Bonus',
  'Referral',
  'FollowTask',
  'LikeTask',
  'CoinsOrder',
  'Spin',
  'Unfollow',
  'FollowersOrder',
  'LikesOrder',
  'CodeUnlock',
];

export const GET = handle(async (request) => {
  await requireAdmin(request);

  const { page, perPage, skip, search, orderBy } = listParams(request, {
    sortable: SORTABLE,
    defaultSort: 'id',
    defaultDir: 'desc',
  });

  const sp = new URL(request.url).searchParams;

  const where = {};
  const type = sp.get('type');
  if (type && TYPES.includes(type)) where.type = type;

  const userId = parseInt(sp.get('user_id') ?? '', 10);
  if (Number.isFinite(userId)) where.userId = userId;

  // Only "earned" or only "spent" rows — the two most common things to want to see.
  const direction = sp.get('direction');
  if (direction === 'earned') where.gain = { gt: 0 };
  if (direction === 'spent') where.lost = { gt: 0 };

  const or = searchOr(search, ['username', 'postPk']);
  if (or) Object.assign(where, or);

  const [total, items] = await Promise.all([
    db.coinsHistory.count({ where }),
    db.coinsHistory.find({
      where,
      include: { user: true, order: true },
      orderBy,
      skip,
      limit: perPage,
    }),
  ]);

  // Totals for the current filter, so the header can say what the page adds up to
  // rather than only what is visible.
  const [gainSum, lostSum] = await Promise.all([
    CoinsHistory.aggregate([{ $match: where }, { $group: { _id: null, t: { $sum: '$gain' } } }]),
    CoinsHistory.aggregate([{ $match: where }, { $group: { _id: null, t: { $sum: '$lost' } } }]),
  ]);

  return {
    ...listResult(items, { page, perPage, total }),
    totals: { gain: gainSum[0]?.t ?? 0, lost: lostSum[0]?.t ?? 0 },
  };
});
