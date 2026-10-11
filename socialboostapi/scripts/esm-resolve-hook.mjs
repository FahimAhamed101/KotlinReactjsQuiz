// Node ESM requires explicit file extensions, but the app's own modules use
// extensionless specifiers (`import { err } from './errors'`) because they rely
// on Next.js/webpack resolution. Plain `node scripts/foo.mjs` therefore dies with
// ERR_MODULE_NOT_FOUND.
//
// This hook appends ".js" when a relative specifier fails to resolve as-is, so
// scripts can import the REAL lib/signature.js. That matters: generating test
// vectors from a hand-copied clone of the server would prove nothing, because
// the Kotlin side would only be validated against my copy of the algorithm
// rather than against the code that actually verifies requests.
//
// Usage: node --import ./scripts/register-esm-hook.mjs scripts/whatever.mjs
//
// Two shapes must be handled, not one:
//   './errors'  -> './errors.js'        (a module)
//   './models'  -> './models/index.js'  (a directory)
// Appending '.js' blindly turns the directory case into './models.js', which
// does not exist, so the directory form needs its own fallback. Both attempts
// must be wrapped: a throw from the first fallback would otherwise escape
// before the second is tried.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (e) {
    if (specifier.startsWith('.') && !/\.[cm]?js$/.test(specifier)) {
      try {
        return await nextResolve(`${specifier}.js`, context);
      } catch {
        try {
          return await nextResolve(`${specifier}/index.js`, context);
        } catch {
          // Neither form exists; surface the original resolution error, which
          // names the specifier the caller actually wrote.
          throw e;
        }
      }
    }
    throw e;
  }
}
