// Shared parsing for the panel's list endpoints.
//
// Centralised because the same three footguns show up on every list screen:
//   1. an unclamped `per_page` lets a caller ask for the entire collection,
//   2. an unsanitised `sort` field is both an error source and an injection surface,
//   3. an unescaped search term turns `(` into an invalid regex and 500s the endpoint.

/** Escape a user-supplied string for use inside a RegExp. */
export function escapeRegex(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {Request} request
 * @param {{sortable: string[], defaultSort?: string, defaultDir?: 'asc'|'desc', perPage?: number}} opts
 */
export function listParams(request, { sortable, defaultSort = 'id', defaultDir = 'desc', perPage = 25 }) {
  const sp = new URL(request.url).searchParams;

  const pageRaw = parseInt(sp.get('page') ?? '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  const perPageRaw = parseInt(sp.get('per_page') ?? String(perPage), 10);
  const size = Number.isFinite(perPageRaw) ? Math.min(100, Math.max(1, perPageRaw)) : perPage;

  // An unknown sort field falls back to the default rather than reaching Mongo: an
  // arbitrary field name would otherwise silently return an unordered page.
  const requested = sp.get('sort') ?? defaultSort;
  const sort = sortable.includes(requested) ? requested : defaultSort;

  const dir = (sp.get('dir') ?? defaultDir) === 'asc' ? 'asc' : 'desc';

  return {
    page,
    perPage: size,
    skip: (page - 1) * size,
    search: (sp.get('q') ?? '').trim(),
    filter: (sp.get('filter') ?? '').trim(),
    sort,
    dir,
    sort: { [sort]: dir },
  };
}

/** Case-insensitive "contains" across several fields, or null when there is no term. */
export function searchOr(search, fields) {
  if (!search) return null;
  const rx = new RegExp(escapeRegex(search), 'i');
  return { $or: fields.map((field) => ({ [field]: rx })) };
}

/** Shape returned by every admin list endpoint. */
export function listResult(items, { page, perPage, total }) {
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  return {
    items,
    meta: {
      page,
      per_page: perPage,
      total,
      last_page: lastPage,
      from: total === 0 ? 0 : (page - 1) * perPage + 1,
      to: total === 0 ? 0 : (page - 1) * perPage + items.length,
    },
  };
}
