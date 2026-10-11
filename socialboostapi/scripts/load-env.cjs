// Minimal .env loader for the CLI scripts.
//
// Next.js loads .env into process.env automatically; plain Node does not. Any
// script that signs a request must load it first, or the HMAC secret silently
// becomes the empty string and every signature is wrong in a way that looks like
// a server bug ("InvalidSignature" on a correctly signed request).
const { existsSync, readFileSync } = require('node:fs');

/** Load KEY=value pairs into process.env without overwriting existing values. */
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

module.exports = { loadEnv };
