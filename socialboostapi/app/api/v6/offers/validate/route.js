// POST /api/v6/offers/validate
//
// Ported from V4OfferController::validateOffer -> OfferService::validateAndLogDeeplink.

import { handle } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { readJson, requireInt, requireString } from '@/lib/validate';
import { validateAndLogDeeplink } from '@/lib/services/offers';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  const user = await guard(request, body, { signature: true });

  const offerId = requireInt(body, 'offer_id');
  const token = requireString(body, 'token', { max: 50 });

  await validateAndLogDeeplink(user, offerId, token);
  return null;
});
