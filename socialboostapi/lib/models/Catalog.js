// Sellable catalogue: product types, products, offers and the offer-log tables.

import mongoose from 'mongoose';
import { autoId, defineModel, uniqueWhenPresent, withJsonShape } from './_base';

const productTypeSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      { name: { type: String, required: true } },
      { collection: 'product_types' },
    ),
    'product_types',
  ),
);

const productSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        actionCount: { type: Number, required: true },
        oldId: { type: String, default: null },
        off: { type: Number, default: null },

        // null coinsPrice => Premium (paid through Google Play); non-null => Free (coins)
        coinsPrice: { type: Number, default: null },
        price: { type: String, default: null },
        billingProductId: { type: String, default: null, index: true },

        productTypeId: { type: Number, required: true, index: true },

        isActive: { type: Boolean, default: false, index: true },
        category: { type: Number, default: 1 }, // 1 = General, 2 = Offer
      },
      { timestamps: true, collection: 'products' },
    ),
    'products',
  ),
);

const offerSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        name: { type: String, required: true },
        productId: { type: Number, required: true, index: true },

        // Bitmask — see OfferTargeting in lib/constants.js
        targetingCriteria: { type: Number, required: true },
        notificationFrequency: { type: Number, default: 1 },
        startDate: { type: Date, default: Date.now },
        expireDate: { type: Date, default: null },
        notificationEnabled: { type: Boolean, default: false },
        deeplinkEnabled: { type: Boolean, default: false },
        status: { type: String, default: 'pending' }, // pending | active | canceled | expired
        maxAvail: { type: Number, default: 1 },
        token: { type: String, default: null },
      },
      { timestamps: true, collection: 'offers' },
    ),
    'offers',
  ),
);

// A shareable offer token must resolve to one offer only, while an offer created
// without one must still be insertable. `sparse: true` fails the second half of
// that requirement because `default: null` makes the field present on every row —
// so the second token-less offer collides on null. See `uniqueWhenPresent`.
offerSchema.index(...uniqueWhenPresent('token'));

const deeplinkLogSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        userId: { type: Number, required: true, index: true },
        offerId: { type: Number, required: true, index: true },
      },
      { timestamps: { createdAt: true, updatedAt: false }, collection: 'users_offers_deeplink_log' },
    ),
    'users_offers_deeplink_log',
  ),
);

const displayHistorySchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        userId: { type: Number, required: true, index: true },
        offerId: { type: Number, required: true, index: true },
      },
      {
        timestamps: { createdAt: true, updatedAt: false },
        collection: 'users_offers_display_history',
      },
    ),
    'users_offers_display_history',
  ),
);

deeplinkLogSchema.index({ userId: 1, offerId: 1 });
displayHistorySchema.index({ userId: 1, offerId: 1 });

export const ProductType = defineModel('ProductType', productTypeSchema, 'product_types');
export const Product = defineModel('Product', productSchema, 'products');
export const Offer = defineModel('Offer', offerSchema, 'offers');
export const UserOfferDeeplinkLog = defineModel(
  'UserOfferDeeplinkLog',
  deeplinkLogSchema,
  'users_offers_deeplink_log',
);
export const UserOfferDisplayHistory = defineModel(
  'UserOfferDisplayHistory',
  displayHistorySchema,
  'users_offers_display_history',
);
