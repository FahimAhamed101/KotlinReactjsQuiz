// GET /api/v6/me/history
//
// Ported from AuthController::history — the user's coins ledger, newest first.

import { handle, paginate } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { coinsHistoryResource } from '@/lib/resources';
import { pageOf } from '@/lib/validate';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

const PER_PAGE = 30;

export const GET = handle(async (request) => {
  const user = await guard(request, {}, { signature: true });
  const page = pageOf(request, 1);

  const [rows, total] = await Promise.all([
    db.coinsHistory.find({
      where: { userId: user.id },
      sort: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      limit: PER_PAGE,
    }),
    db.coinsHistory.count({ where: { userId: user.id } }),
  ]);

  return paginate(rows.map(coinsHistoryResource), { page, perPage: PER_PAGE, total });
});
