// Mirrored profile pictures.
//
// TikTok CDN avatar URLs are **time-signed and expire in roughly two days**. Storing
// one in `accounts.avatarLarger` therefore buys about 48 hours: after that every load
// returns 403 and the client shows an empty ring, which reads as "the profile picture
// is broken" even though nothing in the app changed.
//
// Vercel also has no scraping key, so it cannot fetch a fresh URL on its own — it can
// only serve what is already in the database. Keeping the image bytes here makes the
// avatar independent of both problems: the signature on the origin URL stops mattering,
// and any deployment that shares this MongoDB can serve the picture.
//
// This is deliberately a *mirror*, not a source of truth. `accounts.avatarLarger` stays
// the upstream URL for parity; this collection is what the app actually renders.
//
// **Keyed by (platform, username), not username alone.** `@demo` exists on TikTok,
// Instagram and Facebook as three different people with three different photos; a
// username-only key would serve whichever one was fetched last.
//
// NOTE: no `autoId` here, on purpose. `autoId` declares `id` as `unique`, and the rows
// in this collection are written with `updateOne(..., { upsert: true })`, which does not
// allocate an id — so every row carried `id: null` and the second insert died with
//
//   E11000 duplicate key error collection: coinapp.avatars index: id_1 dup key: { id: null }
//
// This collection is keyed by (platform, username) and is never addressed by numeric id,
// so it simply does not get one.

import mongoose from 'mongoose';
import { defineModel, withJsonShape } from './_base';

const avatarSchema = withJsonShape(
  new mongoose.Schema(
    {
      platform: { type: String, default: 'tiktok', index: true },
      // Lower-cased handle on that platform. One row per account, overwritten on refresh.
      username: { type: String, required: true, index: true },
      contentType: { type: String, default: 'image/jpeg' },
      // The image itself. Avatars are ~10-40 KB; the 16 MB document limit is not in
      // play, and keeping it in the document means one read serves one request.
      data: { type: Buffer, required: true },
      bytes: { type: Number, default: 0 },
      // Which upstream URL produced these bytes — for debugging a stale mirror.
      sourceUrl: { type: String, default: null },
      fetchedAt: { type: Date, default: Date.now },
    },
    { timestamps: true, collection: 'avatars' },
  ),
);

avatarSchema.index(
  { platform: 1, username: 1 },
  { unique: true, name: 'platform_username_1' },
);

export const Avatar = defineModel('Avatar', avatarSchema, 'avatars');
