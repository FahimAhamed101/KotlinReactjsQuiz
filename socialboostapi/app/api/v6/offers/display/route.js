// POST /api/v6/offers/display
//
// Ported from V4OfferController::trackOfferDisplay -> OfferService::trackOfferDisplay.
// Recording a display suppresses the offer for `offer_display_time_in_minutes`.

import { handle } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { readJson, requireInt, requireString } from '@/lib/validate';
import { trackOfferDisplay } from '@/lib/services/offers';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  const user = await guard(request, body, { signature: true });

  const offerId = requireInt(body, 'offer_id');
  const token = requireString(body, 'token', { max: 50 });

  await trackOfferDisplay(user, offerId, token);
  return null;
});
