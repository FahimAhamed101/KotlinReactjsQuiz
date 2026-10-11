'use client';

// Sidebar navigation. A client component because active-link highlighting needs
// `usePathname`, which is not available in a Server Component.

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLogoutMutation } from '@/lib/store/adminApi';

const LINKS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/coins', label: 'Coins ledger' },
  { href: '/admin/codes', label: 'Codes' },
  { href: '/admin/products', label: 'Products' },
];

export default function Nav({ admin }) {
  const pathname = usePathname();
  const router = useRouter();
  const [logout, { isLoading }] = useLogoutMutation();

  const isActive = (href) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  async function onLogout() {
    await logout().unwrap();
    router.replace('/admin/login');
    router.refresh();
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">TT</span>
        <span>
          <span className="brand-name">SocialBoost</span>
          <span className="brand-sub" style={{ display: 'block' }}>
            Admin panel
          </span>
        </span>
      </div>

      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`nav-link${isActive(link.href) ? ' active' : ''}`}
        >
          {link.label}
        </Link>
      ))}

      <div style={{ marginTop: 'auto', paddingTop: 16 }}>
        <div className="brand-sub" style={{ padding: '0 11px 8px' }}>
          Signed in as
          <br />
          <span className="muted">{admin?.email ?? 'unknown'}</span>
        </div>
        <button
          className="btn btn-ghost"
          onClick={onLogout}
          disabled={isLoading}
          style={{ width: '100%', textAlign: 'left' }}
        >
          {isLoading ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </aside>
  );
}
