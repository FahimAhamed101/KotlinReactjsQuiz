// GET /api/v6/codes
//
// The source-code catalogue, carrying the SERVER's coin price.
//
// The client merges this with the portfolio API's display metadata (images,
// description, USD price). Only identity and price live here — that is
// deliberate: the coin price is the thing worth trusting, so it is the thing
// the client is not allowed to decide.

import { handle } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { codeResource } from '@/lib/resources';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request) => {
  await guard(request, {}, { signature: true });

  const codes = await db.code.find({
    where: { isActive: true },
    sort: { coinsPrice: 'asc' },
  });

  return codes.map(codeResource);
});
