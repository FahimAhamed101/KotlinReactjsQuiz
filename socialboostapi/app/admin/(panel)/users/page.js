'use client';

// Users list — search, filter, sort and page through every account.

import { useEffect, useState } from 'react';
import { useUsersQuery } from '@/lib/store/adminApi';
import {
  Loading,
  ErrorState,
  EmptyState,
  Badge,
  Pager,
  Th,
  When,
  UserLink,
} from '../_components/ui';

const PER_PAGE = 25;

export default function UsersPage() {
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('id');
  const [dir, setDir] = useState('desc');

  // Debounce so typing does not fire a request per keystroke. Resetting the page here
  // (rather than in the input handler) keeps page and search in step: otherwise a search
  // from page 3 would request page 3 of the filtered set and usually come back empty.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(term);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [term]);

  const { data, isLoading, isFetching, error, refetch } = useUsersQuery({
    page,
    per_page: PER_PAGE,
    q: search || undefined,
    status: status || undefined,
    sort,
    dir,
  });

  function onSort(field, nextDir) {
    setSort(field);
    setDir(nextDir);
    setPage(1);
  }

  const items = data?.items ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p className="page-sub">
            {data ? `${data.meta.total.toLocaleString('en-US')} accounts` : 'Accounts and balances'}
          </p>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search by email or name…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="Active">Active</option>
          <option value="Suspended">Suspended</option>
        </select>
        {isFetching && !isLoading && <span className="dim">updating…</span>}
      </div>

      <div className="card">
        {isLoading ? (
          <Loading label="Loading users…" />
        ) : error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No users match"
            hint={search || status ? 'Try clearing the search or the status filter.' : undefined}
          />
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <Th label="ID" field="id" sort={sort} dir={dir} onSort={onSort} />
                  <Th label="Email" field="email" sort={sort} dir={dir} onSort={onSort} />
                  <Th label="Name" field="name" sort={sort} dir={dir} onSort={onSort} />
                  <Th label="Coins" field="coins" sort={sort} dir={dir} onSort={onSort} align="right" />
                  <Th label="Orders" />
                  <Th label="Unlocks" />
                  <Th label="Status" field="status" sort={sort} dir={dir} onSort={onSort} />
                  <Th label="Last active" field="lastActivityAt" sort={sort} dir={dir} onSort={onSort} />
                </tr>
              </thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id}>
                    <td className="mono dim">{u.id}</td>
                    <td>
                      <UserLink id={u.id} email={u.email} />
                      {u.isAdmin && (
                        <span className="badge badge-premium" style={{ marginLeft: 7 }}>
                          admin
                        </span>
                      )}
                    </td>
                    <td>{u.name || <span className="dim">—</span>}</td>
                    <td className="num" style={{ color: 'var(--amber)', fontWeight: 600 }}>
                      {u.coins.toLocaleString('en-US')}
                    </td>
                    <td className="num">{u.orders_count}</td>
                    <td className="num">
                      {u.unlocks_count}
                      {u.coins_spent_on_codes > 0 && (
                        <span className="dim"> ({u.coins_spent_on_codes.toLocaleString('en-US')})</span>
                      )}
                    </td>
                    <td>
                      <Badge value={u.status} />
                    </td>
                    <td>
                      <When value={u.lastActivityAt} />
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
