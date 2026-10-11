const { google } = require('googleapis');

const packageName = process.env.PACKAGE_NAME;

const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_SERVICE_ACCOUNT,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});

async function androidPublisher() {
  const authClient = await auth.getClient();

  return google.androidpublisher({
    version: 'v3',
    auth: authClient,
  });
}

/**
 * Verify One-Time In-App Product purchase
 */
async function verifyPurchase({ productId, purchaseToken }) {
  const publisher = await androidPublisher();

  const response = await publisher.purchases.products.get({
    packageName,
    productId,
    token: purchaseToken,
  });

  return response.data;
}

/**
 * Consume One-Time In-App Product
 */
async function consumePurchase({ productId, purchaseToken }) {
  const publisher = await androidPublisher();

  await publisher.purchases.products.consume({
    packageName,
    productId,
    token: purchaseToken,
  });
}

/**
 * Verify $5 USD Google Play Subscription
 * Supports both standard subscription API and subscriptionv2
 */
async function verifySubscription({ subscriptionId, purchaseToken }) {
  const publisher = await androidPublisher();

  try {
    // Try newer Subscriptions v2 API first
    const responseV2 = await publisher.purchases.subscriptionsv2.get({
      packageName,
      token: purchaseToken,
    });

    if (responseV2 && responseV2.data) {
      return {
        isV2: true,
        data: responseV2.data,
        state: responseV2.data.subscriptionState,
        // SUBSCRIPTION_STATE_ACTIVE = 1 in v2
        isActive: responseV2.data.subscriptionState === 'SUBSCRIPTION_STATE_ACTIVE',
        lineItems: responseV2.data.lineItems,
      };
    }
  } catch (err) {
    console.log('Subscriptions v2 get fallback to v1:', err.message);
  }

  // Fallback to classic v1 subscriptions API
  const response = await publisher.purchases.subscriptions.get({
    packageName,
    subscriptionId,
    token: purchaseToken,
  });

  const sub = response.data;
  const now = Date.now();
  const expiry = Number(sub.expiryTimeMillis || 0);

  return {
    isV2: false,
    data: sub,
    paymentState: sub.paymentState, // 1 = Received, 2 = Free trial
    acknowledgementState: sub.acknowledgementState, // 0 = Yet to be acknowledged, 1 = Acknowledged
    autoRenewing: sub.autoRenewing,
    expiryTimeMillis: sub.expiryTimeMillis,
    isActive: expiry > now && (sub.paymentState === 1 || sub.paymentState === 2),
    orderId: sub.orderId,
  };
}

/**
 * Acknowledge Subscription to prevent automatic Google Play refund after 3 days
 */
async function acknowledgeSubscription({ subscriptionId, purchaseToken, developerPayload }) {
  const publisher = await androidPublisher();

  await publisher.purchases.subscriptions.acknowledge({
    packageName,
    subscriptionId,
    token: purchaseToken,
    requestBody: {
      developerPayload: developerPayload || 'buy_codes_sub_5usd',
    },
  });
}

/**
 * Acknowledge a one-time in-app product.
 *
 * Acknowledgement is mandatory: Google Play automatically refunds and revokes any
 * purchase that is not acknowledged within 3 days.
 *
 * NOTE: deliberately NOT consuming. For a code store the user buys a licence for
 * life, so the product must stay in the "owned" state and be restorable via
 * purchases.products.get / queryPurchasesAsync.
 */
async function acknowledgeProduct({ productId, purchaseToken }) {
  const publisher = await androidPublisher();

  await publisher.purchases.products.acknowledge({
    packageName,
    productId,
    token: purchaseToken,
  });
}

module.exports = {
  verifyPurchase,
  consumePurchase,
  acknowledgeProduct,
  verifySubscription,
  acknowledgeSubscription,
};