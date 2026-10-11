// POST /api/admin/logout — clears the panel session cookie.

import { handle, success } from '@/lib/envelope';
import { ADMIN_COOKIE, adminCookieOptions } from '@/lib/adminAuth';

export const dynamic = 'force-dynamic';

export const POST = handle(async () => {
  const response = success({ logged_out: true });
  // Same options as login (so path/sameSite match) with maxAge 0 to expire it now.
  response.cookies.set(ADMIN_COOKIE, '', { ...adminCookieOptions(), maxAge: 0 });
  return response;
});
