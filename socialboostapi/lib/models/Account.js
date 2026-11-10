// Accounts plus the per-account counters used by the task checker.
//
// `username` is unique **per platform**, not globally — a compound (platform, username)
// index. That matters: `@demo` is three different people on TikTok, Instagram and
// Facebook, and a global unique index on the handle alone would let only one of them be
// stored at all (the second insert died with E11000). The same reasoning applies to
// `follow_counts` below, which is looked up by the same (platform, username) pair.
//
// Every unique index here is created through `compoundUnique`/`uniqueWhenPresent` rather
// than the bare `unique: true` shorthand, because the shorthand produces a single-field
// index that Mongo will not replace when the schema changes — an existing
// `username_1 {unique: true}` has to be dropped explicitly, and the server-side indexes
// are read back by scripts/mongo-check.mjs to prove which mechanism is in force.

import mongoose from 'mongoose';
import { autoId, compoundUnique, defineModel, withJsonShape } from './_base';

const accountSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        // Which network this row belongs to. Defaults to TikTok so every existing row and
        // every client that does not send the field keeps working exactly as before.
        // `@demo` exists on all three platforms as three different people, so this is part
        // of the identity — see the compound unique index declared below.
        platform: { type: String, default: 'tiktok', index: true },
        username: { type: String, required: true, index: true },
        isBanned: { type: Boolean, default: false },

        tiktokId: { type: String, default: null },
        secUid: { type: String, default: null, index: true },
        avatarLarger: { type: String, default: null },
        avatarMedium: { type: String, default: null },
        avatarThumb: { type: String, default: null },
        // True once the bytes are in the `avatars` collection. The upstream URLs above
        // are time-signed and expire; this flag says "render /api/v6/avatar/<username>
        // instead", which is what makes the picture survive the signature expiring.
        avatarMirrored: { type: Boolean, default: false },
        nickname: { type: String, default: null },
        region: { type: String, default: null },
        secret: { type: Boolean, default: false },
        privateAccount: { type: Boolean, default: false },
        signature: { type: String, default: null },
        verified: { type: Boolean, default: false },

        following: { type: Number, default: 0 },
        follower: { type: Number, default: 0 },
        // Total likes the account has received — TikTok's `heart` / `heartCount`.
        // Null, not 0, when the network does not expose it (neither an Instagram nor a
        // Facebook profile carries such a figure), so the client can distinguish "none"
        // from "unknown" instead of printing a confident zero.
        heartCount: { type: Number, default: null },

        // Baseline used by the unfollow-deduction cycle.
        coinDeductionCycleStartFollowingCount: { type: Number, default: 0 },
        coinDeductionCycleCounterNotFound: { type: Number, default: 0 },
        coinDeductionCycleId: { type: Number, default: null },
      },
      { timestamps: true, collection: 'accounts' },
    ),
    'accounts',
  ),
);

const followCountSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        // Which network this anchor belongs to. The checker compares a viewer's *own*
        // following count, and the viewer exists on exactly one network per login, so the
        // anchor has to be scoped the same way the Account row is — otherwise a TikTok
        // `@demo` anchor would be used to verify an Instagram follow.
        platform: { type: String, default: 'tiktok', index: true },
        username: { type: String, required: true, index: true },
        followerCount: { type: Number, default: 0 },
        followingCount: { type: Number, default: 0 },
        // The checker's anchor. Deliberately NOT overwritten on later loads, or a
        // completed task could be re-verified forever.
        lastCheckedFollowing: { type: Number, default: 0 },
        accountId: { type: Number, default: null },
      },
      { timestamps: true, collection: 'follow_counts' },
    ),
    'follow_counts',
  ),
);

const likesCountSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        orderId: { type: Number, required: true, index: true },
        url: { type: String, default: null },
        lastCount: { type: Number, default: null },
        ttUsername: { type: String, required: true },
        // Kept for the same reason as on follow_counts: the like baseline is fetched from
        // a specific network's provider, and the row has to record which one so a later
        // verification reads the same source.
        platform: { type: String, default: 'tiktok', index: true },
        isLiked: { type: Boolean, default: false },
        accountId: { type: Number, default: null },
      },
      { timestamps: true, collection: 'like_counts' },
    ),
    'like_counts',
  ),
);

const skipCountSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        userId: { type: Number, required: true, index: true },
        orderId: { type: Number, required: true, index: true },
        username: { type: String, default: null },
        accountId: { type: Number, default: null },
        count: { type: Number, default: 0 },
      },
      { timestamps: true, collection: 'skip_counts' },
    ),
    'skip_counts',
  ),
);

const reportSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        accountId: { type: Number, required: true, index: true },
        type: { type: String, required: true },
        details: { type: String, default: null },
        orderId: { type: Number, required: true, index: true },
        status: { type: String, default: 'pending' },
      },
      { timestamps: true, collection: 'reports' },
    ),
    'reports',
  ),
);

// Identity is (platform, username). Declared explicitly rather than with `unique: true`
// on the field, so the server-side index name is predictable and the old single-field
// `username_1` unique index can be dropped in favour of this one.
accountSchema.index(...compoundUnique(['platform', 'username']));
followCountSchema.index(...compoundUnique(['platform', 'username']));
// NOT unique on like_counts, deliberately.
//
// A baseline row is per (order, viewer): the POST endpoint always inserts a new row and
// the checker reads back the newest with `sort: { id: 'desc' }`. Two viewers priming the
// same order therefore produce two rows, so a unique (orderId, platform) index would
// reject the second viewer outright. A plain compound index is what the lookup actually
// needs.
likesCountSchema.index({ orderId: 1, platform: 1 });

export const Account = defineModel('Account', accountSchema, 'accounts');
export const FollowCount = defineModel('FollowCount', followCountSchema, 'follow_counts');
export const LikesCount = defineModel('LikesCount', likesCountSchema, 'like_counts');
export const SkipCount = defineModel('SkipCount', skipCountSchema, 'skip_counts');
export const Report = defineModel('Report', reportSchema, 'reports');
