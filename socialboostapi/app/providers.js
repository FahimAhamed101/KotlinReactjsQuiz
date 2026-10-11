'use client';

// Client-side store provider.
//
// The store is created once per browser session and cached on `window` so React
// Fast Refresh does not rebuild it on every edit — a fresh store on each hot reload
// would throw away the RTK Query cache and make the panel refetch on every keystroke.

import { useRef } from 'react';
import { Provider } from 'react-redux';
import { makeStore } from '@/lib/store';

export default function Providers({ children }) {
  const storeRef = useRef(null);

  if (!storeRef.current) {
    storeRef.current = makeStore();
  }

  return <Provider store={storeRef.current}>{children}</Provider>;
}
