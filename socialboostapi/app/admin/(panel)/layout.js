// The panel guard.
//
// This is a Server Component, so the check runs on the server before any panel markup is
// sent. A client-side guard would still ship the page's data and markup to an
// unauthenticated visitor — hiding it with CSS is not access control.
//
// The API routes are guarded independently (`requireAdmin` in each handler), because a
// layout protects pages, not endpoints.

import { redirect } from 'next/navigation';
import { currentAdmin } from '@/lib/adminAuth';
import Nav from './nav';

export const dynamic = 'force-dynamic';

export default async function PanelLayout({ children }) {
  const admin = await currentAdmin();
  if (!admin) redirect('/admin/login');

  return (
    <div className="shell">
      <Nav admin={{ id: admin.id, email: admin.email, name: admin.name }} />
      <main className="main">{children}</main>
    </div>
  );
}
