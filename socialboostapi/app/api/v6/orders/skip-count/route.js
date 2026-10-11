// POST /api/v6/orders/skip-count
//
// Ported from OrderController::skipCount.
// Records that the viewer's account skipped a task. A task reappears in the feed
// until it has been skipped 3 times (see lib/services/feed.js).

import { handle } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { readJson, requireInt, tiktokUsername, optionalString } from '@/lib/validate';
import { resolveAccount } from '@/lib/services/coinsCheck';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  const user = await guard(request, body, { signature: true });

  const orderId = requireInt(body, 'order_id');
  tiktokUsername(body, 'username', { required: false });
  optionalString(body, 'sec_uid', { max: 255 });

  const account = await resolveAccount(body);

  const existing = await db.skipCount.findOne({
    where: {
      userId: user.id,
      orderId,
      accountId: account?.id ?? null,
    },
  });

  const row = existing
    ? await db.skipCount.update({
        where: { id: existing.id },
        data: { count: { increment: 1 } },
      })
    : await db.skipCount.create({
        data: {
          userId: user.id,
          orderId,
          accountId: account?.id ?? null,
          username: account?.username ?? null,
          count: 1,
        },
      });

  return row;
});
