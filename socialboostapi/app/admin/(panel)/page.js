'use client';

// Dashboard — the panel's landing screen.

import Link from 'next/link';
import { useStatsQuery } from '@/lib/store/adminApi';
import { Loading, ErrorState, Stat } from './_components/ui';

export default function DashboardPage() {
  const { data, isLoading, error, refetch } = useStatsQuery();

  if (isLoading) return <Loading label="Loading dashboard…" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { users, orders, catalogue, economy } = data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="page-sub">
            Coins exchanged for likes, followers and source-code unlocks.
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <Stat
          label="Users"
          value={users.total.toLocaleString('en-US')}
          hint={`${users.admins} admin${users.admins === 1 ? '' : 's'} · ${users.suspended} suspended`}
        />
        <Stat
          label="Coins in circulation"
          value={economy.coins_in_circulation.toLocaleString('en-US')}
          hint={`${economy.ledger_rows.toLocaleString('en-US')} ledger rows`}
        />
        <Stat
          label="Orders"
          value={orders.total.toLocaleString('en-US')}
          hint={`${orders.progress} running · ${orders.pending} pending`}
        />
        <Stat
          label="Codes unlocked"
          value={catalogue.unlocks.toLocaleString('en-US')}
          hint={`${catalogue.codes} in the catalogue`}
        />
      </div>

      <div className="section-title">Economy</div>
      <div className="card">
        <div className="detail-grid">
          <div className="detail-cell">
            <div className="stat-label">Coins earned</div>
            <div className="stat-value" style={{ fontSize: 19, color: 'var(--emerald)' }}>
              +{economy.coins_earned.toLocaleString('en-US')}
            </div>
            <div className="stat-hint">Tasks, bonuses and referrals</div>
          </div>
          <div className="detail-cell">
            <div className="stat-label">Coins spent</div>
            <div className="stat-value" style={{ fontSize: 19, color: 'var(--amber)' }}>
              −{economy.coins_spent.toLocaleString('en-US')}
            </div>
            <div className="stat-hint">Order placements and code unlocks</div>
          </div>
          <div className="detail-cell">
            <div className="stat-label">Catalogue</div>
            <div className="stat-value" style={{ fontSize: 19 }}>
              {catalogue.products}
            </div>
            <div className="stat-hint">
              Active products ·{' '}
              <Link href="/admin/products" style={{ color: 'var(--cyan)' }}>
                view
              </Link>
            </div>
          </div>
          <div className="detail-cell">
            <div className="stat-label">Orders completed</div>
            <div className="stat-value" style={{ fontSize: 19 }}>
              {orders.completed}
            </div>
            <div className="stat-hint">{orders.canceled} cancelled</div>
          </div>
        </div>
      </div>

      <div className="section-title">Jump to</div>
      <div className="card">
        <div className="detail-grid">
          {[
            ['Users', '/admin/users', `${users.total} accounts and their balances`],
            ['Orders', '/admin/orders', `${orders.total} orders across every user`],
            ['Coins ledger', '/admin/coins', 'Every earn and spend, explained'],
            ['Codes', '/admin/codes', `${catalogue.codes} codebases, ${catalogue.unlocks} unlocked`],
          ].map(([label, href, hint]) => (
            <Link key={href} href={href} className="detail-cell" style={{ display: 'block' }}>
              <div className="stat-label">{label}</div>
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{hint}</div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
