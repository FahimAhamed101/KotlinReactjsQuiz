'use client';

// Codes — the source-code catalogue and how each title sells.

import { useCodesQuery } from '@/lib/store/adminApi';
import { Loading, ErrorState, EmptyState, When, Stat } from '../_components/ui';

export default function CodesPage() {
  const { data, isLoading, error, refetch } = useCodesQuery();

  if (isLoading) return <Loading label="Loading catalogue…" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { items, totals } = data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Codes</h1>
          <p className="page-sub">
            The coin price lives here, not on the client — a tampered build cannot unlock a
            codebase cheaply.
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <Stat
          label="Codes"
          value={totals.codes}
          hint={`${totals.active} active · ${totals.never_sold} never unlocked`}
        />
        <Stat label="Unlocks" value={totals.unlocks} hint="All time" />
        <Stat
          label="Coins collected"
          value={totals.coins_collected.toLocaleString('en-US')}
          hint="Spent on unlocking codes"
        />
        <Stat
          label="Price range"
          value={`${totals.cheapest.toLocaleString('en-US')}–${totals.dearest.toLocaleString('en-US')}`}
          hint="Coins, cheapest to dearest"
        />
      </div>

      <div className="card">
        {items.length === 0 ? (
          <EmptyState title="The catalogue is empty" hint="Run the seeder to load the code catalogue." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Slug</th>
                <th className="num">Price</th>
                <th className="num">Unlocks</th>
                <th className="num">Coins collected</th>
                <th>Last unlocked</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>{c.title}</td>
                  <td className="mono dim">{c.slug}</td>
                  <td className="num" style={{ color: 'var(--amber)', fontWeight: 600 }}>
                    {c.coinsPrice.toLocaleString('en-US')}
                  </td>
                  <td className="num">
                    {c.unlocks === 0 ? <span className="dim">0</span> : c.unlocks}
                  </td>
                  <td className="num">
                    {c.coins_collected === 0 ? (
                      <span className="dim">0</span>
                    ) : (
                      c.coins_collected.toLocaleString('en-US')
                    )}
                  </td>
                  <td>
                    <When value={c.last_unlocked_at} />
                  </td>
                  <td>
                    <span className={`badge badge-${c.isActive ? 'active' : 'canceled'}`}>
                      {c.isActive ? 'yes' : 'no'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
