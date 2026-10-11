// GET /api/admin/me — who is signed in, and the panel's own capability flags.
//
// The UI calls this on mount so it can render (or hide) admin-only affordances. It is
// not the security boundary: every mutating route calls requireAdmin() itself.

import { handle } from '@/lib/envelope';
import { requireAdmin } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  const admin = await requireAdmin(request);
  return {
    admin: { id: admin.id, email: admin.email, name: admin.name, isAdmin: admin.isAdmin },
    permissions: {
      view_users: true,
      view_orders: true,
      view_codes: true,
      // Reserved for later: mutating other users' balances is a deliberate no-op today.
      adjust_coins: false,
    },
  };
});
