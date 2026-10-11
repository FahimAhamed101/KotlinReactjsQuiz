// Users and their API tokens.

import mongoose from 'mongoose';
import { autoId, defineModel, withJsonShape } from './_base';

const userSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        name: { type: String, default: null },
        email: { type: String, required: true, unique: true, index: true },
        // `select: false` so the hash never rides along on an ordinary query — it has
        // to be asked for explicitly (`.select('+adminPasswordHash')`) in the panel
        // login path only.
        adminPasswordHash: { type: String, default: null, select: false },

        // Vestigial. The mobile client's login does NOT verify a password — it looks
        // the user up by email and issues a token (the Laravel original stored
        // Hash::make($id)). Kept because register writes it and the column is NOT NULL
        // upstream. The admin panel deliberately uses adminPasswordHash instead, so
        // tightening one never silently loosens the other.
        password: { type: String, required: true, select: false },
        fcmToken: { type: String, default: null },
        oldId: { type: String, default: null },
        isAdmin: { type: Boolean, default: false, index: true },
        coins: { type: Number, default: 0 },
        status: { type: String, default: 'Active' }, // Active | Suspended

        lastActivityAt: { type: Date, default: Date.now },
        lastPurchaseAt: { type: Date, default: null },
        lastPremiumPurchaseAt: { type: Date, default: null },
      },
      { timestamps: true, collection: 'users' },
    ),
    'users',
  ),
);

const tokenSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        userId: { type: Number, required: true, index: true },
        name: { type: String, required: true },
        token: { type: String, required: true, unique: true, index: true },
        lastUsedAt: { type: Date, default: null },
        expiresAt: { type: Date, default: null },
      },
      { timestamps: { createdAt: true, updatedAt: false }, collection: 'personal_access_tokens' },
    ),
    'personal_access_tokens',
  ),
);

export const User = defineModel('User', userSchema, 'users');
export const PersonalAccessToken = defineModel(
  'PersonalAccessToken',
  tokenSchema,
  'personal_access_tokens',
);
