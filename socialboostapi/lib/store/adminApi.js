// RTK Query API for the admin panel.
//
// One `createApi` for the whole panel, with tag types so a mutation can invalidate the
// screens it actually affects. Every endpoint returns the project's `{success, data}`
// envelope, so `transformResponse` unwraps it once here rather than in each component —
// a screen that forgets to unwrap would render `undefined` and look like an empty state.

import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

/** Pull the human-readable message out of an error envelope. */
function messageFrom(response) {
  if (response?.data?.message) return response.data.message;
  if (response?.data?.error_code) return response.data.error_code;
  if (response?.status === 401) return 'Your session has expired. Please sign in again.';
  return response?.error || 'Request failed.';
}

export const adminApi = createApi({
  reducerPath: 'adminApi',
  baseQuery: fetchBaseQuery({ baseUrl: '/api/admin' }),
  tagTypes: ['Admin', 'Stats', 'User', 'Order', 'Code', 'Product', 'Coins'],

  endpoints: (build) => ({
    // --- session ---
    me: build.query({
      query: () => '/me',
      transformResponse: (r) => r.data,
      providesTags: ['Admin'],
    }),

    login: build.mutation({
      query: (body) => ({ url: '/login', method: 'POST', body }),
      transformResponse: (r) => r.data,
      invalidatesTags: ['Admin', 'Stats', 'User', 'Order', 'Code', 'Product', 'Coins'],
    }),

    logout: build.mutation({
      query: () => ({ url: '/logout', method: 'POST' }),
      transformResponse: (r) => r.data,
      invalidatesTags: ['Admin'],
    }),

    // --- data ---
    stats: build.query({
      query: () => '/stats',
      transformResponse: (r) => r.data,
      providesTags: ['Stats'],
    }),

    users: build.query({
      query: (params) => ({ url: '/users', params }),
      transformResponse: (r) => r.data,
      providesTags: ['User'],
    }),

    user: build.query({
      query: (id) => `/users/${id}`,
      transformResponse: (r) => r.data,
      providesTags: (_r, _e, id) => [{ type: 'User', id }],
    }),

    orders: build.query({
      query: (params) => ({ url: '/orders', params }),
      transformResponse: (r) => r.data,
      providesTags: ['Order'],
    }),

    coins: build.query({
      query: (params) => ({ url: '/coins', params }),
      transformResponse: (r) => r.data,
      providesTags: ['Coins'],
    }),

    codes: build.query({
      query: () => '/codes',
      transformResponse: (r) => r.data,
      providesTags: ['Code'],
    }),

    products: build.query({
      query: () => '/products',
      transformResponse: (r) => r.data,
      providesTags: ['Product'],
    }),
  }),
});

export const {
  useMeQuery,
  useLoginMutation,
  useLogoutMutation,
  useStatsQuery,
  useUsersQuery,
  useUserQuery,
  useOrdersQuery,
  useCoinsQuery,
  useCodesQuery,
  useProductsQuery,
} = adminApi;

export { messageFrom };
