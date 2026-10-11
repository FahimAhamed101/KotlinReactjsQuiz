'use client';

// User detail — balance, ledger, orders and code unlocks for one account.

import Link from 'next/link';
import { useUserQuery } from '@/lib/store/adminApi';
import { Loading, ErrorState, EmptyState, Badge, When, Stat } from '../../_components/ui';

export default function UserDetailPage({ params }) {
  const { data, isLoading, error, refetch } = useUserQuery(params.id);

  if (isLoading) return <Loading label="Loading user…" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { user, summary, orders, ledger, unlocks, payments } = data;

  return (
    <>
      <div className="crumb">
        <Link href="/admin/users" style={{ color: 'var(--cyan)' }}>
          Users
        </Link>{' '}
        / #{user.id}
      </div>

      <div className="page-head">
        <div>
          <h1>
            {user.name || user.email}{' '}
            {user.isAdmin && <span className="badge badge-premium">admin</span>}
          </h1>
          <p className="page-sub">
            {user.email} · joined <When value={user.createdAt} />
          </p>
        </div>
        <Badge value={user.status} />
      </div>

      <div className="stat-grid">
        <Stat label="Coin balance" value={user.coins.toLocaleString('en-US')} hint="What the app shows" />
        <Stat label="Orders" value={summary.orders} hint={`${orders.length} shown below`} />
        <Stat
          label="Codes unlocked"
          value={summary.unlocks}
          hint={`${summary.coins_spent.toLocaleString('en-US')} coins spent in total`}
        />
        <Stat
          label="Ledger rows"
          value={summary.ledger_rows}
          hint={`+${summary.coins_gained.toLocaleString('en-US')} earned`}
        />
      </div>

      {summary.balance_drift !== 0 && (
        // Surfaced rather than hidden: the app writes `coins` on every earn and spend, so
        // a non-zero drift means a write was missed somewhere and is worth investigating.
        <div className="banner banner-error">
          Balance drift of <strong>{summary.balance_drift.toLocaleString('en-US')}</strong> coins: the
          stored balance does not match the ledger (earned {summary.coins_gained.toLocaleString('en-US')},
          spent {summary.coins_spent.toLocaleString('en-US')}).
        </div>
      )}

      <div className="section-title">Recent orders ({orders.length})</div>
      <div className="card">
        {orders.length === 0 ? (
          <EmptyState title="No orders yet" hint="This user has not placed any orders." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Target</th>
                <th>Product</th>
                <th>Type</th>
                <th className="num">Progress</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="mono dim">{o.id}</td>
                  <td>@{o.username}</td>
                  <td>
                    {o.product ? (
                      <>
                        {o.product.productType?.name ?? 'Product'} ×{o.product.actionCount}
                      </>
                    ) : (
                      <span className="dim">#{o.productId}</span>
                    )}
                  </td>
                  <td>
                    <Badge value={o.type} />
                  </td>
                  <td className="num">
                    {o.currentProgress}/{o.actualMaxProgress}
                  </td>
                  <td>
                    <Badge value={o.status} />
                  </td>
                  <td>
                    <When value={o.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="section-title">Code unlocks ({unlocks.length})</div>
      <div className="card">
        {unlocks.length === 0 ? (
          <EmptyState title="No codes unlocked" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Slug</th>
                <th className="num">Coins paid</th>
                <th>Unlocked</th>
              </tr>
            </thead>
            <tbody>
              {unlocks.map((u) => (
                <tr key={u.id}>
                  <td>{u.code?.title ?? <span className="dim">#{u.codeId}</span>}</td>
                  <td className="mono dim">{u.code?.slug ?? '—'}</td>
                  <td className="num" style={{ color: 'var(--amber)' }}>
                    {u.coinsSpent.toLocaleString('en-US')}
                  </td>
                  <td>
                    <When value={u.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="section-title">Coins ledger ({ledger.length} most recent)</div>
      <div className="card">
        {ledger.length === 0 ? (
          <EmptyState title="No ledger entries" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Detail</th>
                <th className="num">Earned</th>
                <th className="num">Spent</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((h) => (
                <tr key={h.id}>
                  <td className="mono dim">{h.id}</td>
                  <td>
                    <Badge value={h.type} />
                  </td>
                  <td className="muted">
                    {h.username ? `@${h.username}` : h.postPk ? h.postPk : <span className="dim">—</span>}
                    {h.orderId ? <span className="dim"> · order #{h.orderId}</span> : null}
                  </td>
                  <td className="num" style={{ color: h.gain ? 'var(--emerald)' : undefined }}>
                    {h.gain ? `+${h.gain}` : ''}
                  </td>
                  <td className="num" style={{ color: h.lost ? 'var(--rose)' : undefined }}>
                    {h.lost ? `−${h.lost}` : ''}
                  </td>
                  <td>
                    <When value={h.createdAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {payments.length > 0 && (
        <>
          <div className="section-title">Play payments ({payments.length})</div>
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Product</th>
                  <th>Order</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="mono dim">{p.id}</td>
                    <td className="mono">{p.billingProductId ?? '—'}</td>
                    <td className="mono dim">{p.orderId ?? '—'}</td>
                    <td>
                      <Badge value={p.status} />
                    </td>
                    <td>
                      <When value={p.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
