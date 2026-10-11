// POST /api/v6/payment/notify
//
// Ported from V4PaymentController::notify -> PaymentService::processMobileNotification.
//
// The mobile client creates a Pending order first, then pays through Google Play, and
// finally calls this endpoint to tell the server the purchase token. The server verifies
// the token with Play, stores the payment record, and activates the order.
//
// Request body: { order_id, purchase_token, google_order_id }

import { handle, success } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { readJson, requireInt, requireString } from '@/lib/validate';
import { err } from '@/lib/errors';
import db from '@/lib/db';
import { OrderStatus } from '@/lib/constants';
import { processTransaction } from '@/lib/services/googlePlay';
import { orderResource } from '@/lib/resources';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  const user = await guard(request, body, { signature: true });

  const orderId = requireInt(body, 'order_id');
  const purchaseToken = requireString(body, 'purchase_token', { max: 500 });
  const googleOrderId = body.google_order_id || null;

  const order = await db.order.findOne({
    where: { id: orderId },
    include: { product: { include: { productType: true } }, user: true },
  });

  if (!order || order.userId !== user.id) {
    throw err.orderNotFound('Order not found.');
  }

  // Already paid or already in progress — idempotent.
  if (order.status !== OrderStatus.Pending) {
    return success(orderResource(order));
  }

  const product = order.product;
  if (!product?.billingProductId) {
    throw err.unknown('This order has no Google Play product associated with it.');
  }

  // Verify the receipt with Google Play.
  const purchaseData = await processTransaction(purchaseToken, product.billingProductId, {
    expectedOrderId: order.id,
  });
  if (!purchaseData) {
    throw err.unknown('Google Play could not verify this purchase token.');
  }

  // Store the payment record.
  const payment = await db.payment.create({
    data: {
      orderId: order.id,
      purchaseToken,
      googleOrderId: purchaseData.googleOrderId ?? googleOrderId ?? null,
      billingProductId: product.billingProductId,
      status: purchaseData.consumed ? 'consumed' : 'pending',
    },
  });

  // Defensive: the purchase must belong to this order.
  if (purchaseData.orderId && purchaseData.orderId !== order.id) {
    throw err.orderNotFound('Payment metadata order ID does not match.');
  }

  // Activate the order if the purchase was consumed successfully.
  if (purchaseData.consumed) {
    await db.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.Progress,
        purchaseToken: payment.purchaseToken,
      },
    });

    await db.user.update({
      where: { id: user.id },
      data: { lastActivityAt: new Date(), lastPurchaseAt: new Date() },
    });
  }

  const fresh = await db.order.findOne({
    where: { id: order.id },
    include: { product: { include: { productType: true } }, user: true },
  });

  return success(orderResource(fresh));
});
