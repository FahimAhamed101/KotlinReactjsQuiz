// GET /api/v6/orders/{id} — order detail.
//
// Ported from OrderController::show -> OrderService::getOrderDetail.
//
// Next.js routing note: `reactivate` and `skip-count` are static siblings of this
// dynamic segment. Static segments always win, so POST /orders/reactivate never
// lands here.

import { handle } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { ApiException } from '@/lib/errors';
import { orderResource } from '@/lib/resources';
import { getOrderDetail } from '@/lib/services/orders';

export const dynamic = 'force-dynamic';

export const GET = handle(async (request, { params }) => {
  const user = await guard(request, {}, { signature: true });

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiException('MissingArgument', 'Invalid order id.');
  }

  const { order, isOwnOrder } = await getOrderDetail(user, id);

  // Someone else's order is returned with its counters stripped rather than
  // refused, so a shared link still renders. Mirrors OrderService::hideSensitiveData
  // and matches what the feed already does.
  return orderResource(
    isOwnOrder
      ? order
      : { ...order, startCount: null, expectedCount: null, orderId: null, purchaseToken: null },
  );
});
