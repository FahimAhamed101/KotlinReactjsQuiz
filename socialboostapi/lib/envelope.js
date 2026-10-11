// Response envelope + handler wrapper.
//
// Ported from App\Http\Helpers\ApiResponse and the HandlesResponse trait.
//
// Success: { "success": true,  "data": <data> }
// Error:   { "success": false, "error_code": "<CaseName>", "message"?, "errors"?, "data": [] }
//
// `message` and `errors` are omitted when null — matching the Laravel
// `array_filter(..., fn ($v) => $v !== null)` behaviour. `data` is always present
// because an empty array is not null.

import { NextResponse } from 'next/server';
import { ApiException, ValidationException, ApiErrorCode } from './errors';

export function success(data = null, statusCode = 200) {
  return NextResponse.json({ success: true, data }, { status: statusCode });
}

export function error(code, message = null, statusCode = 400, errors = null, data = []) {
  const payload = { success: false, error_code: code };
  if (message !== null && message !== undefined) payload.message = message;
  if (errors !== null && errors !== undefined) payload.errors = errors;
  payload.data = data ?? [];

  return NextResponse.json(payload, { status: statusCode ?? ApiErrorCode[code] ?? 400 });
}

/**
 * Wrap a route handler so it always produces the TTBoost envelope.
 * Mirrors HandlesResponse::handleApi().
 *
 * The handler returns plain data (which gets wrapped) or a NextResponse
 * (which is passed through untouched, e.g. for /server-time).
 */
export function handle(fn) {
  return async (request, context) => {
    try {
      const result = await fn(request, context);
      if (result instanceof NextResponse || result instanceof Response) return result;
      return success(result);
    } catch (e) {
      if (e instanceof ApiException) {
        return error(e.code, e.message === e.code ? null : e.message, e.statusCode, null, e.data);
      }
      if (e instanceof ValidationException) {
        return error('Validation', null, 422, e.errors);
      }
      // Anything unexpected: log and return the generic envelope, exactly as the
      // Laravel handler does (it logs then returns ApiResponse::error(Unknown)).
      console.error('[ttboost-api] unhandled error:', e);
      return error('Unknown', e?.message ?? null, 400);
    }
  };
}

/** Laravel-shaped paginator JSON. */
export function paginate(rows, { page = 1, perPage = 30, total = null } = {}) {
  const t = total ?? rows.length;
  const lastPage = Math.max(1, Math.ceil(t / perPage));
  const url = (p) => `?page=${p}`;
  return {
    current_page: page,
    data: rows,
    first_page_url: url(1),
    from: t === 0 ? null : (page - 1) * perPage + 1,
    last_page: lastPage,
    last_page_url: url(lastPage),
    next_page_url: page < lastPage ? url(page + 1) : null,
    path: '',
    per_page: perPage,
    prev_page_url: page > 1 ? url(page - 1) : null,
    to: t === 0 ? null : (page - 1) * perPage + rows.length,
    total: t,
  };
}
