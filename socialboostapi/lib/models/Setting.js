// Key/value application settings (coin prices, per-page sizes, order caps).

import mongoose from 'mongoose';
import { autoId, defineModel, withJsonShape } from './_base';

const settingSchema = withJsonShape(
  autoId(
    new mongoose.Schema(
      {
        key: { type: String, required: true, unique: true, index: true },
        details: { type: String, default: null },
        value: { type: String, required: true },
      },
      { timestamps: true, collection: 'settings' },
    ),
    'settings',
  ),
);

export const Setting = defineModel('Setting', settingSchema, 'settings');
