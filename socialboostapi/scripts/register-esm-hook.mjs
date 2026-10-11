// Registers the extension-adding resolver hook for scripts run as plain Node ESM.
// See esm-resolve-hook.mjs for why this exists.
import { register } from 'node:module';

register('./esm-resolve-hook.mjs', import.meta.url);
