// GET /api/v6/me
//
// Ported from AuthController::me — the user block plus the full settings map.

import { handle } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { userResource } from '@/lib/resources';
import { allSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  const user = await guard(request, {}, { signature: true });
  const preferences = await allSettings({ fresh: true });

  return { user: userResource(user), preferences };
});
