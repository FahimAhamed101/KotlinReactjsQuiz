// Request validation.
//
// Ported from the Laravel FormRequests (App\Http\Requests\*). The rules and the
// resulting 422 `errors` map match, including the username regex:
//
//   ^(?!.*\.$)[a-zA-Z0-9._]+$   with length 2..24

import { ValidationException } from './errors';

export const USERNAME_RE = /^(?!.*\.$)[a-zA-Z0-9._]+$/;

export function assert(condition, field, message) {
  if (condition) return;
  throw new ValidationException({ [field]: [message] });
}

export function requireString(body, field, { min = 1, max = 255, message } = {}) {
  const value = body?.[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationException({ [field]: [`The ${field} field is required.`] });
  }
  const len = value.length;
  if (len < min || len > max) {
    throw new ValidationException({
      [field]: [message || `The ${field} field must be between ${min} and ${max} characters.`],
    });
  }
  return value;
}

export function optionalString(body, field, { max = 255 } = {}) {
  const value = body?.[field];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new ValidationException({ [field]: [`The ${field} field must be a string.`] });
  }
  if (value.length > max) {
    throw new ValidationException({ [field]: [`The ${field} field may not be greater than ${max} characters.`] });
  }
  return value;
}

/** The 2..24 TikTok-handle rule used across the API. */
export function tiktokUsername(body, field, { required = true } = {}) {
  const value = body?.[field];
  if (value === undefined || value === null || value === '') {
    if (!required) return null;
    throw new ValidationException({ [field]: [`The ${field} field is required.`] });
  }
  if (typeof value !== 'string' || value.length < 2 || value.length > 24 || !USERNAME_RE.test(value)) {
    throw new ValidationException({
      [field]: [`The ${field} field format is invalid.`],
    });
  }
  return value;
}

export function requireInt(body, field) {
  const value = body?.[field];
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  if (!Number.isFinite(n)) {
    throw new ValidationException({ [field]: [`The ${field} field is required.`] });
  }
  return n;
}

export function optionalInt(body, field) {
  const value = body?.[field];
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  if (!Number.isFinite(n)) {
    throw new ValidationException({ [field]: [`The ${field} field must be an integer.`] });
  }
  return n;
}

export function optionalBool(body, field) {
  const value = body?.[field];
  if (value === undefined || value === null || value === '') return null;
  return value === true || value === 'true' || value === 1 || value === '1';
}

/** Parse a JSON body, tolerating an empty body (treated as {}). */
export async function readJson(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Pagination query helper. */
export function pageOf(request, fallback = 1) {
  const raw = new URL(request.url).searchParams.get('page');
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
