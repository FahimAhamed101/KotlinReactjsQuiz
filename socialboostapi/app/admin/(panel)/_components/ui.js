'use client';

// Shared panel UI pieces.
//
// These exist so that every screen handles the same three states the same way. The
// important one is the error state: an admin screen that renders a failed request as an
// empty table tells the operator "there are no users" when the truth is "the request
// failed", and those two need very different responses.

import Link from 'next/link';
import { messageFrom } from '@/lib/store/adminApi';

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="state">
      <div className="spinner" />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="state">
      <div className="state-title">Could not load this data</div>
      <div style={{ marginBottom: 14 }}>{messageFrom(error)}</div>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title = 'Nothing here yet', hint }) {
  return (
    <div className="state">
      <div className="state-title">{title}</div>
      {hint && <div>{hint}</div>}
    </div>
  );
}

/** Status pill. Unknown values fall back to neutral rather than rendering unstyled. */
export function Badge({ value }) {
  if (value === null || value === undefined || value === '') {
    return <span className="dim">—</span>;
  }
  const key = String(value).toLowerCase();
  return <span className={`badge badge-${key}`}>{value}</span>;
}

export function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

/** Sortable table header. Clicking toggles direction on the active column. */
export function Th({ label, field, sort, dir, onSort, align }) {
  if (!field) {
    return <th className={align === 'right' ? 'num' : undefined}>{label}</th>;
  }

  const active = sort === field;
  const arrow = active ? (dir === 'asc' ? ' ↑' : ' ↓') : '';

  return (
    <th
      className={`sortable${align === 'right' ? ' num' : ''}`}
      onClick={() => onSort(field, active && dir === 'desc' ? 'asc' : 'desc')}
      title="Click to sort"
    >
      {label}
      <span style={{ color: active ? 'var(--indigo)' : 'var(--text-dim)' }}>{arrow || ' ↕'}</span>
    </th>
  );
}

export function Pager({ meta, onPage }) {
  if (!meta) return null;

  return (
    <div className="pager">
      <span>
        {meta.total === 0
          ? 'No rows'
          : `Showing ${meta.from}–${meta.to} of ${meta.total}`}
      </span>
      <div className="pager-btns">
        <button className="btn" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          Previous
        </button>
        <button
          className="btn"
          disabled={meta.page >= meta.last_page}
          onClick={() => onPage(meta.page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function Money({ value, suffix = '' }) {
  if (value === null || value === undefined) return <span className="dim">—</span>;
  return (
    <span className="num">
      {Number(value).toLocaleString('en-US')}
      {suffix}
    </span>
  );
}

export function When({ value }) {
  if (!value) return <span className="dim">—</span>;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return <span className="dim">—</span>;
  return (
    <span className="muted" title={d.toISOString()}>
      {d.toLocaleString('en-GB', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })}
    </span>
  );
}

export function UserLink({ id, email }) {
  if (!id) return <span className="dim">—</span>;
  return (
    <Link href={`/admin/users/${id}`} style={{ color: 'var(--cyan)' }}>
      {email ?? `#${id}`}
    </Link>
  );
}
