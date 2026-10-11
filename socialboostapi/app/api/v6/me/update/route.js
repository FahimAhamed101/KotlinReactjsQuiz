// PUT /api/v6/me/update
//
// Ported from AuthController::update. The only mutable field the client sends is the
// FCM token (`token`), which is stored on the user row for push notifications.

import { handle, success } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { readJson, optionalString } from '@/lib/validate';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export const PUT = handle(async (request) => {
  const body = await readJson(request);
  const user = await guard(request, body, { signature: true });

  const token = optionalString(body, 'token', { max: 500 });
  if (token) {
    await db.user.update({ where: { id: user.id }, data: { fcmToken: token } });
  }

  return success(true);
});
