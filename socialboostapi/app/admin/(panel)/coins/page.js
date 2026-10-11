'use client';

// Coins ledger — the audit trail that makes every balance explainable.

import { useEffect, useState } from 'react';
import { useCoinsQuery } from '@/lib/store/adminApi';
import {
  Loading,
  ErrorState,
  EmptyState,
  Badge,
  Pager,
  Th,
  When,
  UserLink,
  Stat,
} from '../_components/ui';

const PER_PAGE = 25;
const TYPES = [
  'Bonus',
  'Referral',
  'FollowTask',
  'LikeTask',
  'CoinsOrder',
  'Spin',
  'Unfollow',
  'FollowersOrder',
  'LikesOrder',
  'CodeUnlock',
];

export default function CoinsPage() {
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [direction, setDirection] = useState('');
  const [sort, setSort] = useState('id');
  const [dir, setDir] = useState('desc');

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(term);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [term]);

  const { data, isLoading, isFetching, error, refetch } = useCoinsQuery({
    page,
    per_page: PER_PAGE,
    q: search || undefined,
    type: type || undefined,
    direction: direction || undefined,
    sort,
    dir,
  });

  function onSort(field, nextDir) {
    setSort(field);
    setDir(nextDir);
    setPage(1);
  }

  const items = data?.items ?? [];
  const totals = data?.totals;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Coins ledger</h1>
          <p className="page-sub">
            {data
              ? `${data.meta.total.toLocaleString('en-US')} entries match the current filter`
              : 'Every earn and spend across the platform'}
          </p>
        </div>
      </div>

      {totals && (
        <div className="stat-grid">
          <Stat
            label="Earned (filtered)"
            value={`+${totals.gain.toLocaleString('en-US')}`}
            hint="Tasks, bonuses, referrals"
          />
          <Stat
            label="Spent (filtered)"
            value={`−${totals.lost.toLocaleString('en-US')}`}
            hint="Orders and code unlocks"
          />
          <Stat
            label="Net (filtered)"
            value={(totals.gain - totals.lost).toLocaleString('en-US')}
            hint="Coins created minus coins destroyed"
          />
        </div>
      )}

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search by username or post id…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All types</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={direction}
          onChange={(e) => {
            setDirection(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Earned and spent</option>
          <option value="earned">Earned only</option>
          <option value="spent">Spent only</option>
        </select>
        {isFetching && !isLoading && <span className="dim">updating…</span>}
      </div>

      <div className="card">
        {isLoading ? (
          <Loading label="Loading ledger…" />
        ) : error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : items.length === 0 ? (
          <EmptyState title="No ledger entries match" hint="Try clearing the search or the filters." />
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <Th label="ID" field="id" sort={sort} dir={dir} onSort={onSort} />
                  <Th label="User" />
                  <Th label="Type" field="type" sort={sort} dir={dir} onSort={onSort} />
                  <Th label="Detail" />
                  <Th label="Earned" field="gain" sort={sort} dir={dir} onSort={onSort} align="right" />
                  <Th label="Spent" field="lost" sort={sort} dir={dir} onSort={onSort} align="right" />
                  <Th label="When" field="createdAt" sort={sort} dir={dir} onSort={onSort} />
                </tr>
              </thead>
              <tbody>
                {items.map((h) => (
                  <tr key={h.id}>
                    <td className="mono dim">{h.id}</td>
                    <td>
                      <UserLink id={h.userId} email={h.user?.email} />
                    </td>
                    <td>
                      <Badge value={h.type} />
                    </td>
                    <td className="muted">
                      {h.username ? `@${h.username}` : null}
                      {h.postPk ? <span className="mono dim"> {h.postPk}</span> : null}
                      {h.orderId ? <span className="dim"> · order #{h.orderId}</span> : null}
                      {!h.username && !h.postPk && !h.orderId ? <span className="dim">—</span> : null}
                    </td>
                    <td className="num" style={{ color: h.gain ? 'var(--emerald)' : undefined }}>
                      {h.gain ? `+${h.gain.toLocaleString('en-US')}` : ''}
                    </td>
                    <td className="num" style={{ color: h.lost ? 'var(--rose)' : undefined }}>
                      {h.lost ? `−${h.lost.toLocaleString('en-US')}` : ''}
                    </td>
                    <td>
                      <When value={h.createdAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager meta={data.meta} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
