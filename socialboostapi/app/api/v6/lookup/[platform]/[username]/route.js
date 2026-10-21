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

import { handle } from '@/lib/envelope';
import { verifyHash } from '@/lib/signature';
import { accountResourceV2 } from '@/lib/resources';
import { getProfileInfo } from '@/lib/services/tiktok';
import { upsertAccountFromProfile } from '@/lib/services/coinsCheck';
import { normalizePlatform, Platform } from '@/lib/services/platforms';
import { err } from '@/lib/errors';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  verifyHash(_request);

  const platform = normalizePlatform(params.platform);
  const username = decodeURIComponent(params.username || '').replace(/^@/, '').toLowerCase();
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
}
