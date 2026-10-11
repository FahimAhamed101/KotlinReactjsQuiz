// GET /api/v6/codes/unlocked
//
// The codes this user has unlocked with coins.
//
// The client merges `code_ids` into its ownership set, which is what makes a
// coin unlock survive a reinstall — unlike the SharedPreferences-only path that
// Google Play purchases use.

import { handle } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  const user = await guard(request, {}, { signature: true });

  const unlocks = await db.codeUnlock.find({
    where: { userId: user.id },
    include: { code: true },
    sort: { createdAt: 'desc' },
  });

  return {
    code_ids: unlocks.map((u) => u.code.slug),
    unlocks: unlocks.map((u) => ({
      code_id: u.code.slug,
      title: u.code.title,
      coins_spent: u.coinsSpent,
      created_at: u.createdAt,
    })),
  };
});
