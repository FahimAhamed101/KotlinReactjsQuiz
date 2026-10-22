// GET /api/v6/lookup/[platform]/[username]
//
// Resolve a handle to a public profile **before sign-in**, so the first screen can show the
// user their own picture and follower count next to what they typed.
//
// Deliberately unauthenticated but signed: there is no bearer token at this point in the
// flow (the user is not signed in yet), and the data is public profile information. The
// request-signature requirement keeps casual abuse out — it is not a security boundary, since
// the key ships in the APK like every other route, so the practical limit is that this only
// exposes what is already public on the platform.
//
// This is the check a user otherwise has no way to make from inside the app: "is this really
// my account, with my picture?" — asked before, not after, they commit to signing in.
//
// IMPORTANT — two bugs used to live here and made *every* username login fail:
//
//   1. The handler was not wrapped in `handle()`. Any throw (including the signature check)
//      escaped as a raw 500 with an EMPTY body, and a success returned a bare object with no
//      `{ success, data }` envelope — so the client's `call()` never saw a payload. It now
//      goes through `handle()`, the same wrapper every other v6 route uses.
//
//   2. It called `verifyHash()` — the legacy `hash` header that only `login`/`register`
//      send. This route is reached through `SocialBoostApi.call()`, which attaches the
//      `X-Signature` headers but never the `hash` header, so the check always failed. It now
//      verifies the v6 request signature instead, which is exactly what the client sends.
//
// Note it deliberately does NOT use `guard()`: the full guard stack requires a current user
// (bearer token), and there is no token before sign-in. Signature-only is the correct gate.

import { handle } from '@/lib/envelope';
import { verifySignature } from '@/lib/signature';
import { accountResourceV2 } from '@/lib/resources';
import { getProfileInfo } from '@/lib/services/tiktok';
import { upsertAccountFromProfile } from '@/lib/services/coinsCheck';
import { normalizePlatform, Platform } from '@/lib/services/platforms';
import { err } from '@/lib/errors';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request, { params }) => {
  // Signed, but not authenticated. `{}` is the body the client signs for a GET.
  verifySignature(request, {});

  const platform = normalizePlatform(params.platform);

  // Next.js may or may not have decoded the segment depending on version; a second decode
  // of an already-decoded handle is a no-op, but a malformed `%` would throw — so guard it.
  let raw = params.username || '';
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* already decoded */
  }
  const username = raw.replace(/^@/, '').toLowerCase();
  if (!username) throw err.missingArgument('A username is required.');

  // Only TikTok has a provider wired up. Saying so beats silently resolving an Instagram
  // handle against TikTok and handing back someone else's profile.
  if (platform !== Platform.TikTok) {
    throw err.apiDisabled(
      `${platform} lookup is not configured yet — add that platform's API host to .env.`,
    );
  }

  // A known row is free, and it is the row sign-in would reuse anyway.
  const known = await db.account.findOne({ where: { platform, username } });
  if (known) return { tiktok_info: accountResourceV2(known), source: 'cached' };

  const profile = await getProfileInfo(username, null);
  if (!profile) {
    throw err.userNotFound(`Could not find @${username} on TikTok. Check the spelling.`);
  }

  const account = await upsertAccountFromProfile(profile);
  return { tiktok_info: accountResourceV2(account), source: 'provider' };
});
