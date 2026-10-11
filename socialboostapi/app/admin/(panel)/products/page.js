'use client';

// Products — what can be bought, and on which payment rail.

import { useProductsQuery } from '@/lib/store/adminApi';
import { Loading, ErrorState, EmptyState, Stat } from '../_components/ui';

export default function ProductsPage() {
  const { data, isLoading, error, refetch } = useProductsQuery();

  if (isLoading) return <Loading label="Loading products…" />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const { items, totals } = data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Products</h1>
          <p className="page-sub">
            <strong>Free</strong> products are paid with coins; <strong>Premium</strong> products
            open the Google Play sheet. That is decided by whether a coin price is set.
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <Stat label="Products" value={totals.products} hint={`${totals.active} active`} />
        <Stat label="Free (coins)" value={totals.free} hint="Charged from the user's balance" />
        <Stat label="Premium (Play)" value={totals.premium} hint="Charged through Google Play" />
        <Stat
          label="Unbuyable"
          value={totals.premium_without_billing_id}
          hint="Premium products with no Play product id"
        />
      </div>

      {totals.premium_without_billing_id > 0 && (
        // Worth shouting about: the client asks Play for this id, and a missing product
        // returns BILLING_UNAVAILABLE — the user sees a failed purchase, not a config error.
        <div className="banner banner-error">
          {totals.premium_without_billing_id} premium product
          {totals.premium_without_billing_id === 1 ? '' : 's'} have no{' '}
          <code>billing_product_id</code>. They cannot be purchased until the id exists in the
          Play Console and is set here.
        </div>
      )}

      <div className="card">
        {items.length === 0 ? (
          <EmptyState title="No products" hint="Run the seeder to load the product catalogue." />
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Product</th>
                <th>Type</th>
                <th>Actions</th>
                <th>Rail</th>
                <th className="num">Coins</th>
                <th>Play price</th>
                <th>Billing product id</th>
                <th className="num">Orders</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td className="mono dim">{p.id}</td>
                  <td>
                    {p.productType ?? <span className="dim">—</span>}
                    <span className="dim"> ×{p.actionCount}</span>
                    {p.off ? <span className="badge badge-neutral" style={{ marginLeft: 7 }}>{p.off}% off</span> : null}
                  </td>
                  <td className="mono dim">{p.oldId ?? '—'}</td>
                  <td className="num">{p.actionCount.toLocaleString('en-US')}</td>
                  <td>
                    <span className={`badge badge-${p.tier === 'Free' ? 'free' : 'premium'}`}>
                      {p.tier}
                    </span>
                  </td>
                  <td className="num">
                    {p.coinsPrice === null || p.coinsPrice === undefined ? (
                      <span className="dim">—</span>
                    ) : (
                      <span style={{ color: 'var(--amber)' }}>
                        {p.coinsPrice.toLocaleString('en-US')}
                      </span>
                    )}
                  </td>
                  <td>{p.price ?? <span className="dim">—</span>}</td>
                  <td className="mono">
                    {p.billingProductId ?? (
                      <span style={{ color: p.tier === 'Premium' ? 'var(--rose)' : 'var(--text-dim)' }}>
                        {p.tier === 'Premium' ? 'missing' : '—'}
                      </span>
                    )}
                  </td>
                  <td className="num">{p.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
