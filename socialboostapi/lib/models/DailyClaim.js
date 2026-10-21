// Daily free-coin claims.
//
// One row per user per day, enforced by a compound unique index. That index is the
// idempotency guard, and it is the database's job rather than the application's: a
// read-then-write check ("has this user claimed today?") races — two taps in quick
// succession both read "no" and both pay out. Inserting into a unique key makes the
// second request fail deterministically no matter how many instances are running,
// which is exactly the property a money-granting endpoint needs.
//
// No `autoId` (see lib/models/Avatar.js for why that trips over `updateOne(upsert)`),
// and this collection is addressed by (userId, day) anyway, never by a numeric id.

import mongoose from 'mongoose';
import { defineModel, withJsonShape } from './_base';

const claimSchema = withJsonShape(
  new mongoose.Schema(
    {
      userId: { type: Number, required: true, index: true },
      // UTC date, YYYY-MM-DD. UTC rather than the server's local timezone so the day
      // boundary does not move when the deployment region does.
      day: { type: String, required: true },
      // Consecutive days claimed. Used for the badge in the client; the payout itself is
      // flat so a longer streak never silently pays more.
      streak: { type: Number, default: 1 },
      amount: { type: Number, default: 0 },
      claimedAt: { type: Date, default: Date.now },
    },
    { timestamps: true, collection: 'daily_claims' },
  ),
);

claimSchema.index({ userId: 1, day: 1 }, { unique: true, name: 'userId_day_1' });

export const DailyClaim = defineModel('DailyClaim', claimSchema, 'daily_claims');
