'use client';

// Panel sign-in.
//
// Deliberately OUTSIDE the `(panel)` route group: that group's layout is the guard, so
// a login page inside it would have to be exempted from the very check it exists to
// satisfy — and an exemption list is exactly where a hole gets left open later.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLoginMutation, messageFrom } from '@/lib/store/adminApi';

export default function LoginPage() {
  const router = useRouter();
  const [login, { isLoading }] = useLoginMutation();

  const [email, setEmail] = useState('admin@ttboost.app');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);

    try {
      await login({ email, password }).unwrap();
      // The session lives in an httpOnly cookie, so the server layout must re-render to
      // see it. Without refresh() the client router can replay a cached redirect back
      // to this page, which looks like "the password was rejected" when it was not.
      router.replace('/admin');
      router.refresh();
    } catch (err) {
      setError(messageFrom(err));
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand" style={{ padding: '0 0 6px' }}>
          <span className="brand-mark">TT</span>
          <span>
            <span className="brand-name">SocialBoost</span>
            <span className="brand-sub" style={{ display: 'block' }}>
              Admin panel
            </span>
          </span>
        </div>

        <h1>Sign in</h1>
        <p className="page-sub">Users, coins, orders and the code catalogue.</p>

        {error && (
          <div className="banner banner-error" style={{ marginTop: 18 }} role="alert">
            {error}
          </div>
        )}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
        </div>

        <button
          className="btn btn-primary"
          type="submit"
          disabled={isLoading}
          style={{ width: '100%', marginTop: 20 }}
        >
          {isLoading ? 'Signing in…' : 'Sign in'}
        </button>

        {process.env.NODE_ENV !== 'production' && (
          <div className="hint">
            Seeded development account: <strong>admin@ttboost.app</strong> — the password comes
            from <code>ADMIN_SEED_PASSWORD</code> in <code>.env</code> (default{' '}
            <code>admin12345</code>). This hint is hidden in production builds.
          </div>
        )}
      </form>
    </div>
  );
}
