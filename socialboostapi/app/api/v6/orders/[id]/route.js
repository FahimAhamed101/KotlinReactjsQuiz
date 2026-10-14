// GET /api/v6/orders/{id} — order detail.
//
// Ported from OrderController::show -> OrderService::getOrderDetail.
//
// Next.js routing note: `reactivate` and `skip-count` are static siblings of this
// dynamic segment. Static segments always win, so POST /orders/reactivate never
// lands here.

import { handle, success } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { ApiException } from '@/lib/errors';
import { orderResource } from '@/lib/resources';
import { getOrderDetail, deletePendingOrder } from '@/lib/services/orders';

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

// DELETE /api/v6/orders/{id} — cancel a pending, unpaid order.
//
// The mobile client creates the order *before* launching Google Play, so a failed
// or abandoned payment leaves a row at status Pending with purchaseToken = null.
// Nothing was ever charged, but the order then sits there forever: it is not served
// in the task feed (only Progress orders are), it is never activated by
// /payment/notify (no token arrives), and it silently occupies the pending slot.
// The user's own reading of that is "I ordered followers and nothing is happening".
//
// So the client must be able to withdraw it. Only a Pending order can be deleted —
// anything already running has coins or money committed against it.
export const DELETE = handle(async (request, { params }) => {
  const body = await request.json().catch(() => ({}));
  const user = await guard(request, body, { signature: true });

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ApiException('MissingArgument', 'Invalid order id.');
  }

  await deletePendingOrder(user, id);
  return success({ deleted: true, id });
});
