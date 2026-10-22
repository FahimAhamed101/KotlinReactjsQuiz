// Avatar mirroring — see lib/models/Avatar.js for why this exists.
//
// Public surface:
//   avatarPath(platform, username)        -> the URL the client should render
//   mirrorAvatar(platform, username, url) -> download and store; true on success
//   getMirroredAvatar(platform, username) -> { data, contentType } | null
//   hasMirror(platform, username)         -> bool
//   avatarUrlFor(account)                 -> mirror path when we have bytes, else upstream
//
// NOTE: every read/write here opens the database connection explicitly.
//
// This module talks to the raw Mongoose model rather than the `db` wrapper, and the wrapper
// is what normally calls `dbConnect()` before each query. On a warm local server another
// route has already connected, so a raw query works by luck — but on a cold serverless
// start nothing has connected yet, so `Avatar.findOne(...)` buffers until it times out and
// the avatar route answers 500. That is exactly the "profile picture is broken on Vercel
// but fine locally" symptom, so the connection is opened here rather than assumed.

import { Avatar } from '../models/Avatar.js';
import { dbConnect } from '../mongodb.js';
import { normalizePlatform } from './platforms';

/** Anything bigger than this is not a profile picture. */
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 8000;

/** True for the picsum placeholder the offline stub produces. */
export function isPlaceholderAvatar(url) {
  return typeof url === 'string' && url.includes('picsum.photos');
}

/**
 * The stable, signature-free URL for an account's picture.
 *
 * Platform-scoped: `@demo` on TikTok, Instagram and Facebook is three different people
 * with three different photos, and a username-only path served all three the same one.
 * TikTok is the default so rows written before platforms existed keep resolving.
 */
export function avatarPath(platform, username) {
  if (!username) return null;
  return `/api/v6/avatar/${normalizePlatform(platform)}/${encodeURIComponent(
    String(username).toLowerCase(),
  )}`;
}

/**
 * What the client should render for this account.
 *
 * Prefers the mirror because it cannot expire. Falls back to the upstream URL when no
 * mirror exists yet (fresh account, or the download has not run), and returns null when
 * the only thing on offer is the picsum placeholder — a placeholder rendered as a real
 * avatar is worse than an empty ring, because it silently looks like the wrong picture.
 */
export function avatarUrlFor(account) {
  if (!account) return null;
  if (account.avatarMirrored) return avatarPath(account.platform, account.username);
  const upstream = account.avatarLarger;
  if (!upstream || isPlaceholderAvatar(upstream)) return null;
  return upstream;
}

/** Read the stored bytes, or null. */
export async function getMirroredAvatar(platform, username) {
  if (!username) return null;
  await dbConnect();
  const row = await Avatar.findOne({
    platform: normalizePlatform(platform),
    username: String(username).toLowerCase(),
  }).lean();
  if (!row?.data) return null;
  return { data: toBuffer(row.data), contentType: row.contentType || 'image/jpeg' };
}

/**
 * `.lean()` skips Mongoose hydration, so a `Buffer` field comes back as the raw BSON
 * `Binary` object rather than a Node Buffer. Handing that to `new Uint8Array(...)` yields an
 * EMPTY array on the local runtime (a 0-byte `image/webp`) and throws outright on the
 * serverless runtime (a 500) — which is exactly why the profile picture rendered as an
 * initials placeholder. Normalise to a real Buffer before the bytes reach `Response`.
 */
function toBuffer(v) {
  if (Buffer.isBuffer(v)) return v;
  if (v && typeof v.value === 'function') {
    const inner = v.value();
    if (Buffer.isBuffer(inner)) return inner;
    if (inner && inner.buffer) return Buffer.from(inner.buffer);
  }
  if (v && Buffer.isBuffer(v.buffer)) return v.buffer;
  return Buffer.from(v);
}

/**
 * Download `url` and store it as this account's picture.
 *
 * Returns true when bytes were stored. Never throws: a mirror failure must not break
 * the profile request that triggered it, because the upstream URL still works until it
 * expires.
 */
export async function mirrorAvatar(platform, username, url) {
  if (!username || !url) return false;
  if (isPlaceholderAvatar(url)) return false; // never bake a placeholder in

  const plat = normalizePlatform(platform);
  const usernameKey = String(username).toLowerCase();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        // The CDNs reject the default fetch agent on some paths.
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
        Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
      },
    });
    if (!res.ok) return false;

    const type = res.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) return false;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return false;

    await dbConnect();
    await Avatar.updateOne(
      { platform: plat, username: usernameKey },
      {
        $set: {
          platform: plat,
          username: usernameKey,
          contentType: type.split(';')[0],
          data: buf,
          bytes: buf.length,
          sourceUrl: url,
          fetchedAt: new Date(),
        },
      },
      { upsert: true },
    );

    // The mirror is now stored, so this has succeeded. Everything below is a convenience
    // (a flag so the serializer can pick the stable URL), and it must not turn a stored
    // picture into a reported failure — it used to be inside the same try, so any problem
    // flipping the flag made the caller think the mirror had failed.
    const stored = true;

    try {
      const { default: db } = await import('../db.js');
      await db.account.update({
        where: { platform: plat, username: usernameKey },
        data: { avatarMirrored: true },
      });
    } catch (e) {
      // Not fatal: `avatarMirrored: false` only costs one extra lookup on the account row,
      // and the bytes are already served from the collection.
      logMirrorNote(`account flag update failed for ${plat}/${usernameKey}: ${e?.message}`);
    }

    return stored;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Mirrors run on request paths that must never fail; log quietly instead of throwing. */
function logMirrorNote(message) {
  if (process.env.NODE_ENV !== 'production') console.warn(`[avatar] ${message}`);
}

/** True when this account already has stored bytes (cheap existence check). */
export async function hasMirror(platform, username) {
  if (!username) return false;
  await dbConnect();
  const row = await Avatar.findOne({
    platform: normalizePlatform(platform),
    username: String(username).toLowerCase(),
  })
    .select({ id: 1 })
    .lean();
  return !!row;
}
