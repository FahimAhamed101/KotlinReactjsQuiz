// The coins ledger, Google Play payments, and the unfollow-deduction cycle marker.

import mongoose from 'mongoose';
import { autoId, defineModel, uniqueWhenPresent, withJsonShape } from './_base';

const coinsHistorySchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        userId: { type: Number, required: true, index: true },
        orderId: { type: Number, default: null, index: true },
        accountId: { type: Number, default: null, index: true },

        username: { type: String, default: null },
        postPk: { type: String, default: null },
        // Bonus | Referral | FollowTask | LikeTask | CoinsOrder | Spin | Unfollow
        // | FollowersOrder | LikesOrder | CodeUnlock
        type: { type: String, required: true },
        gain: { type: Number, default: null },
        lost: { type: Number, default: null },
        count: { type: Number, default: null },
      },
      { timestamps: { createdAt: true, updatedAt: false }, collection: 'coins_histories' },
    ),
    'coins_histories',
  ),
);

coinsHistorySchema.index({ userId: 1, type: 1, createdAt: -1 });

const paymentSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        orderId: { type: Number, default: null, index: true },
        purchaseToken: { type: String, default: null },
        googleOrderId: { type: String, default: null },
        billingProductId: { type: String, default: null },
        status: { type: String, default: 'pending' }, // pending | consumed | refund
        notes: { type: String, default: null },
      },
      { timestamps: true, collection: 'payments' },
    ),
    'payments',
  ),
);

// A purchase token may be redeemed only once — that uniqueness is exactly what
// stops a replayed Play receipt from granting coins twice. Both identifiers must
// therefore be unique *when present*, and `sparse: true` cannot express that here
// (see `uniqueWhenPresent` in ./_base for the full reasoning).
paymentSchema.index(...uniqueWhenPresent('purchaseToken'));
paymentSchema.index(...uniqueWhenPresent('googleOrderId'));

const cycleSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        startedAt: { type: Date, default: Date.now },
        endedAt: { type: Date, default: null },
      },
      { collection: 'unfollow_coins_deductions_cycles' },
    ),
    'unfollow_coins_deductions_cycles',
  ),
);

export const CoinsHistory = defineModel('CoinsHistory', coinsHistorySchema, 'coins_histories');
export const Payment = defineModel('Payment', paymentSchema, 'payments');
export const UnfollowCoinsDeductionCycle = defineModel(
  'UnfollowCoinsDeductionCycle',
  cycleSchema,
  'unfollow_coins_deductions_cycles',
);
