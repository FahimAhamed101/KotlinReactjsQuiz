// The source-code catalogue and its unlocks.
//
// The coin price lives HERE, not on the client: the client renders whatever the server
// says, so a tampered build cannot unlock a $24.99 codebase for 1 coin.
//
// The compound unique index on (userId, codeId) is what makes unlocking idempotent —
// a repeat call cannot insert a second row, so it cannot charge twice. That guarantee
// is enforced by the database, not by application logic that could race.

import mongoose from 'mongoose';
import { autoId, defineModel, withJsonShape } from './_base';

const codeSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        slug: { type: String, required: true, unique: true, index: true },
        title: { type: String, required: true },
        coinsPrice: { type: Number, required: true, index: true },
        isActive: { type: Boolean, default: true, index: true },
      },
      { timestamps: { createdAt: true, updatedAt: false }, collection: 'codes' },
    ),
    'codes',
  ),
);

const codeUnlockSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        userId: { type: Number, required: true, index: true },
        codeId: { type: Number, required: true, index: true },
        coinsSpent: { type: Number, required: true },
      },
      { timestamps: { createdAt: true, updatedAt: false }, collection: 'code_unlocks' },
    ),
    'code_unlocks',
  ),
);

codeUnlockSchema.index({ userId: 1, codeId: 1 }, { unique: true });

export const Code = defineModel('Code', codeSchema, 'codes');
export const CodeUnlock = defineModel('CodeUnlock', codeUnlockSchema, 'code_unlocks');
