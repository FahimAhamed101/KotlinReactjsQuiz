// Orders and their status history.
//
// Note on `startCount` / `expectedCount`: these were Prisma `BigInt` columns, and
// `JSON.stringify` throws on BigInt — which once charged the user coins and then
// reported the order as failed, because the order committed before the resource
// serialised. Mongo stores them as plain numbers, so that whole failure mode is gone.
// `jsonSafe()` in lib/resources.js is kept anyway: it is now a no-op, and it costs
// nothing to stay defensive.

import mongoose from 'mongoose';
import { autoId, defineModel, uniqueWhenPresent, withJsonShape } from './_base';

const orderSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        userId: { type: Number, required: true, index: true },
        productId: { type: Number, required: true, index: true },
        offerId: { type: Number, default: null, index: true },

        image: { type: String, required: true },
        username: { type: String, required: true, index: true },
        accountId: { type: Number, default: null, index: true },

        url: { type: String, required: true },
        postPk: { type: String, default: null },

        startCount: { type: Number, default: null },
        expectedCount: { type: Number, default: null },

        status: { type: String, default: 'Progress' },
        reason: { type: String, default: null },
        type: { type: String, required: true }, // Special | Free | Premium

        currentProgress: { type: Number, default: 0 },
        maxProgress: { type: Number, required: true },
        actualMaxProgress: { type: Number, required: true },
        isLikes: { type: Boolean, required: true },

        // Set only for Google Play purchases, and never reused: a given purchase
        // token or Google order id may fund exactly one order.
        purchaseToken: { type: String, default: null },
        orderId: { type: String, default: null },

        clicks: { type: Number, default: 0 },
        priority: { type: Number, default: 3 },
        adminCanceled: { type: Boolean, default: false },

        finishedAt: { type: Date, default: null },
        deletedAt: { type: Date, default: null },
        reactivatedAt: { type: Date, default: null },
        reactivationCount: { type: Number, default: 0 },
      },
      { timestamps: true, collection: 'orders' },
    ),
    'orders',
  ),
);

// Mirrors the Prisma @@index declarations. The status/type/priority one is what the
// task feed sorts on, so it matters at scale even though it is invisible in dev.
orderSchema.index({ status: 1, type: 1, priority: 1 });
orderSchema.index({ userId: 1, offerId: 1 });

// The vast majority of orders are paid with coins and carry neither of these, so
// these must be unique *when present* — `sparse: true` is not sufficient once
// `default: null` makes the field present on every row. See `uniqueWhenPresent`.
orderSchema.index(...uniqueWhenPresent('purchaseToken'));
orderSchema.index(...uniqueWhenPresent('orderId'));

const orderStatusHistorySchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        orderId: { type: Number, default: null, index: true },
        fromStatus: { type: String, default: null },
        toStatus: { type: String, required: true },
        reason: { type: String, default: null },
      },
      { timestamps: { createdAt: true, updatedAt: false }, collection: 'order_status_histories' },
    ),
    'order_status_histories',
  ),
);

export const Order = defineModel('Order', orderSchema, 'orders');
export const OrderStatusHistory = defineModel(
  'OrderStatusHistory',
  orderStatusHistorySchema,
  'order_status_histories',
);
