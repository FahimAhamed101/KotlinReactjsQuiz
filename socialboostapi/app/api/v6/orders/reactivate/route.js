// POST /api/v6/orders/reactivate
//
// Ported from OrderController::reactivate -> OrderService::reactivateOrder.
//
// A cancelled order may be revived once, but only while its target is still
// reachable. Note the route is a static sibling of /orders/{id}, so it wins over
// the dynamic segment.

import { handle } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { readJson, requireInt } from '@/lib/validate';
import { orderResource } from '@/lib/resources';
import { reactivateOrder } from '@/lib/services/orders';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  const user = await guard(request, body, { signature: true });

  requireInt(body, 'order_id');

  const order = await reactivateOrder(user, body.order_id);

  return orderResource(order);
});
