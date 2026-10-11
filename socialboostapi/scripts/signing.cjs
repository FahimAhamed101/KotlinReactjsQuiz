// Shared signing helper for the CLI test scripts.
//
// lib/signature.js is ESM and uses extensionless internal imports (`./errors`),
// which only Next.js/webpack can resolve. Registering the resolve hook lets these
// CommonJS scripts import the server's REAL signing code, so a test can never
// quietly drift from what the server actually verifies — re-implementing the
// canonical JSON here would mean testing my copy against my copy.
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { register } = require('node:module');
const { loadEnv } = require('./load-env.cjs');

// Next.js loads .env for the server; plain Node does not. Without this the HMAC
// secret is the empty string and every signature is wrong — which surfaces as the
// server rejecting a *correctly* signed request, so it looks like a server bug.
loadEnv(path.join(__dirname, '..', '.env'));

let mod = null;

async function loadSignatureModule() {
  if (mod) return mod;
  if (!process.env.APP_KEY) {
    throw new Error(
      'APP_KEY is empty — ttboost-api/.env was not loaded, so signing would use an empty key.',
    );
  }
  register(
    './esm-resolve-hook.mjs',
    pathToFileURL(path.join(__dirname, 'register-esm-hook.mjs')).href,
  );
  mod = await import('../lib/signature.js');
  return mod;
}

/**
 * Sign a request exactly the way the server re-derives it: the URL pathname with
 * no leading slash and no query string, plus the parsed body (`{}` when absent,
 * which is what `guard(request)` passes for GET routes).
 */
async function signatureHeaders(method, urlPath, body) {
  const { buildSignatureHeaders } = await loadSignatureModule();
  return buildSignatureHeaders({
    method,
    path: urlPath.split('?')[0].replace(/^\/+/, ''),
    body: body ?? {},
  });
}

module.exports = { loadSignatureModule, signatureHeaders };
