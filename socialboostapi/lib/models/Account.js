// TikTok accounts plus the per-account counters used by the task checker.

import mongoose from 'mongoose';
import { autoId, defineModel, withJsonShape } from './_base';

const accountSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        username: { type: String, required: true, unique: true, index: true },
        isBanned: { type: Boolean, default: false },

        tiktokId: { type: String, default: null },
        secUid: { type: String, default: null, index: true },
        avatarLarger: { type: String, default: null },
        avatarMedium: { type: String, default: null },
        avatarThumb: { type: String, default: null },
        nickname: { type: String, default: null },
        region: { type: String, default: null },
        secret: { type: Boolean, default: false },
        privateAccount: { type: Boolean, default: false },
        signature: { type: String, default: null },
        verified: { type: Boolean, default: false },

        following: { type: Number, default: 0 },
        follower: { type: Number, default: 0 },

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
        username: { type: String, required: true, unique: true, index: true },
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

export const Account = defineModel('Account', accountSchema, 'accounts');
export const FollowCount = defineModel('FollowCount', followCountSchema, 'follow_counts');
export const LikesCount = defineModel('LikesCount', likesCountSchema, 'like_counts');
export const SkipCount = defineModel('SkipCount', skipCountSchema, 'skip_counts');
export const Report = defineModel('Report', reportSchema, 'reports');
