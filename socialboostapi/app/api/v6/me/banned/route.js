// POST /api/v6/me/banned
//
// Ported from AuthController::banned. The client sends a list of usernames and the
// server returns the subset that are banned, so the app can warn the user or hide
// those accounts from the feed.

import { handle, success } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { readJson } from '@/lib/validate';
import { Account } from '@/lib/models';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  await guard(request, body, { signature: true });

  const accounts = body?.accounts;
  if (!Array.isArray(accounts) || accounts.length === 0) return success([]);

  const banned = await Account.find({
    username: { $in: accounts.map((u) => u.toLowerCase()) },
    isBanned: true,
  })
    .select('username')
    .lean();

  return success(banned.map((a) => a.username));
});
