// GET /api/v6/offers
//
// Ported from V4OfferController::index -> OfferService::getOffersForUser.

import { handle } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { offerResource } from '@/lib/resources';
import { getOffersForUser } from '@/lib/services/offers';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  const user = await guard(request, {}, { signature: true });

  const visible = await getOffersForUser(user);
  return visible.map(({ offer, displayTime }) => offerResource(offer, displayTime));
});
