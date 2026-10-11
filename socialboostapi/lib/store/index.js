// The panel's Redux store.
//
// Every slice must be registered before `configureStore` runs, and the API middleware
// must be concatenated — without it RTK Query's cache never populates and every query
// stays in its `isLoading` state forever, which looks like a hung network request.

import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { adminApi } from './adminApi';

export function makeStore() {
  const store = configureStore({
    reducer: {
      [adminApi.reducerPath]: adminApi.reducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(adminApi.middleware),
  });

  // Enables refetchOnFocus / refetchOnReconnect.
  setupListeners(store.dispatch);

  return store;
}
