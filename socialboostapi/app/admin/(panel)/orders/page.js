'use client';

// Orders — every order across the platform, filterable by status and type.

import { useEffect, useState } from 'react';
import { useOrdersQuery } from '@/lib/store/adminApi';
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
// 'Cancelled' (double L) is the canonical value — see lib/constants.js. The API
// widens the filter to the legacy 'Canceled' spelling for us.
const STATUSES = ['Progress', 'InQueue', 'Pending', 'Completed', 'Cancelled', 'SmmPanel'];
const TYPES = ['Free', 'Premium', 'Special'];

export default function OrdersPage() {
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState('id');
  const [dir, setDir] = useState('desc');

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(term);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [term]);

  const { data, isLoading, isFetching, error, refetch } = useOrdersQuery({
    page,
    per_page: PER_PAGE,
    q: search || undefined,
    status: status || undefined,
    type: type || undefined,
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
          <h1>Orders</h1>
          <p className="page-sub">
            {data ? `${data.meta.total.toLocaleString('en-US')} orders` : 'Orders across every user'}
          </p>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search by username or URL…"
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
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
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
        {isFetching && !isLoading && <span className="dim">updating…</span>}
      </div>

      <div className="card">
        {isLoading ? (
          <Loading label="Loading orders…" />
        ) : error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No orders match"
            hint="Try clearing the search or the filters."
          />
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <Th label="ID" field="id" sort={sort} dir={dir} onSort={onSort} />
                  <Th label="User" />
                  <Th label="Target" field="username" sort={sort} dir={dir} onSort={onSort} />
                  <Th label="Product" />
                  <Th label="Type" field="type" sort={sort} dir={dir} onSort={onSort} />
                  <Th label="Progress" field="currentProgress" sort={sort} dir={dir} onSort={onSort} align="right" />
                  <Th label="Status" field="status" sort={sort} dir={dir} onSort={onSort} />
                  <Th label="Created" field="createdAt" sort={sort} dir={dir} onSort={onSort} />
                </tr>
              </thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.id}>
                    <td className="mono dim">{o.id}</td>
                    <td>
                      <UserLink id={o.userId} email={o.user?.email} />
                    </td>
                    <td>@{o.username}</td>
                    <td className="muted">
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
            <Pager meta={data.meta} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
