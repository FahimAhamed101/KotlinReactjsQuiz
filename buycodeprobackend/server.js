require('dotenv').config();

const express = require('express');
const {
  verifyPurchase,
  acknowledgeProduct,
  verifySubscription,
  acknowledgeSubscription,
} = require('./google-play');

const app = express();

app.use(express.json());

/**
 * In-memory storage (replace with MongoDB / PostgreSQL in production)
 */
const orders = new Map();
const payments = new Map();
const subscriptions = new Map();

function findOrder(orderId, userId) {
  const order = orders.get(Number(orderId));
  if (!order || order.userId !== userId) {
    return null;
  }
  return order;
}

function savePayment(payment) {
  payments.set(payment.purchaseToken, payment);
  return payment;
}

function activateOrder(orderId) {
  const order = orders.get(Number(orderId));
  if (order) {
    order.status = 'Completed';
  }
  return order;
}

/**
 * Catalog of One-Time In-App Products.
 *
 * These IDs MUST match Constants.PLAY_PRODUCT_IDS in the Android app and the
 * in-app products configured in Google Play Console. Keep the three in sync.
 */
const PRODUCTS_CATALOG = {
  'code_food_multivendor': { title: 'Food-Multivendor Restaurant App', priceUsd: 18.99, type: 'inapp' },
  'code_neibrly_flutter': { title: 'neibrly Flutter Provider App', priceUsd: 21.99, type: 'inapp' },
  'code_macbook_store': { title: 'Macbook Store E-Commerce System', priceUsd: 14.99, type: 'inapp' },
  'code_book_shop': { title: 'Online Book Shop Application', priceUsd: 11.99, type: 'inapp' },
  'code_crud_project': { title: '.NET Core & Next.js Full-Stack Starter', priceUsd: 6.99, type: 'inapp' },
  'code_flutter_ecommerce': { title: 'Flutter Multivendor E-Commerce App', priceUsd: 19.99, type: 'inapp' },
  'code_flutter_news': { title: 'Flutter News & Article App', priceUsd: 8.99, type: 'inapp' },
  'code_kotlin_quiz': { title: 'Kotlin Native Quiz Pro Application', priceUsd: 12.99, type: 'inapp' },
  'code_kotlin_shop': { title: 'Kotlin Multi-Vendor E-Commerce & Firebase', priceUsd: 24.99, type: 'inapp' },
  'code_laravel_ecommerce': { title: 'Laravel Full-Featured E-Commerce System', priceUsd: 16.99, type: 'inapp' },
  'code_laravel_news': { title: 'Laravel Multi-Language News Portal', priceUsd: 11.99, type: 'inapp' },
  'code_lebaba_ecommerce': { title: 'Lebaba MERN Stack E-Commerce Platform', priceUsd: 15.99, type: 'inapp' },
  'code_greatcart_django': { title: 'Greatcart Python & Django Store Engine', priceUsd: 13.99, type: 'inapp' },
  'code_upfront_multivendor': { title: 'Upfront React & Django Multi-Vendor Store', priceUsd: 22.99, type: 'inapp' },
  'code_mern_ecommerce': { title: 'MERN Stack E-Commerce & Stripe', priceUsd: 17.99, type: 'inapp' },
  'code_react_chat': { title: 'Real-Time React & Socket.io Chat App', priceUsd: 9.99, type: 'inapp' },
  'code_nextjs_portfolio': { title: 'Next.js & Prisma Portfolio Platform', priceUsd: 7.99, type: 'inapp' },
};

/** The single subscription product. */
const SUBSCRIPTION_PRODUCT_ID = 'codes_access_5usd_monthly';

/**
 * Health check & products catalog endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Buy Codes Online Payment & Subscription API',
    products_count: Object.keys(PRODUCTS_CATALOG).length,
    subscription_plan: '5 USD Monthly Code Access',
  });
});

app.get('/api/products', (req, res) => {
  res.json({
    success: true,
    products: PRODUCTS_CATALOG,
  });
});

/**
 * Mobile calls this when user subscribes to $5 USD Code Pass / Subscription
 */
app.post('/api/subscription/notify', async (req, res) => {
  try {
    const userId = req.user?.id ?? Number(req.body.user_id || 1);
    const {
      subscription_id = 'codes_access_5usd_monthly',
      purchase_token,
      order_id,
      code_id,
    } = req.body;

    if (!purchase_token) {
      return res.status(422).json({
        error: 'Missing purchase_token',
      });
    }

    console.log(`[Subscription] Verifying $5 USD subscription ${subscription_id} for user ${userId}...`);

    // Verify subscription status with Google Play Developer API
    const subResult = await verifySubscription({
      subscriptionId: subscription_id,
      purchaseToken: purchase_token,
    });

    console.log('[Subscription] Google Play Result:', subResult);

    // If subscription is not active or payment not received
    if (!subResult.isActive) {
      subscriptions.set(purchase_token, {
        userId,
        subscriptionId: subscription_id,
        purchaseToken: purchase_token,
        status: 'InactiveOrPending',
        payload: subResult,
        updatedAt: new Date(),
      });

      return res.status(402).json({
        error: 'Subscription is not active or payment is pending',
        details: subResult,
      });
    }

    // Acknowledge subscription if needed (Google Play requires acknowledgment within 3 days)
    if (!subResult.acknowledgementState || subResult.acknowledgementState === 0) {
      await acknowledgeSubscription({
        subscriptionId: subscription_id,
        purchaseToken: purchase_token,
        developerPayload: `user_${userId}_code_${code_id || 'all'}`,
      });
      console.log('[Subscription] Subscription successfully acknowledged with Google Play');
    }

    // Save active subscription record
    const subRecord = {
      userId,
      subscriptionId: subscription_id,
      purchaseToken: purchase_token,
      orderId: subResult.orderId || order_id,
      amount: '5.00 USD',
      status: 'Active',
      unlockedCodeId: code_id || 'all_codes',
      expiryDate: subResult.expiryTimeMillis ? new Date(Number(subResult.expiryTimeMillis)) : null,
      updatedAt: new Date(),
    };

    subscriptions.set(purchase_token, subRecord);

    if (order_id) {
      activateOrder(order_id);
    }

    return res.json({
      success: true,
      message: '5 USD Subscription verified & activated successfully!',
      subscription: subRecord,
    });
  } catch (error) {
    console.error('[Subscription] Verification error:', error);
    return res.status(500).json({
      error: 'Google Play subscription verification failed',
      message: error.message,
    });
  }
});

/**
 * Mobile calls this after Google Play one-time purchase succeeds.
 */
app.post('/api/payment/notify', async (req, res) => {
  try {
    const userId = req.user?.id ?? Number(req.body.user_id || 1);

    const {
      order_id,
      product_id,
      purchase_token,
      google_order_id,
    } = req.body;

    if (!userId || !product_id || !purchase_token) {
      return res.status(422).json({
        error: 'Missing required fields',
      });
    }

    const order = order_id ? findOrder(order_id, userId) : null;

    if (order && order.status !== 'Pending') {
      return res.json({
        success: true,
        order,
      });
    }

    const purchase = await verifyPurchase({
      productId: product_id,
      purchaseToken: purchase_token,
    });

    if (purchase.purchaseState !== 0) {
      savePayment({
        orderId: order_id,
        productId: product_id,
        purchaseToken: purchase_token,
        googleOrderId: purchase.orderId ?? google_order_id,
        status: 'Failed',
        payload: purchase,
      });

      return res.status(402).json({
        error: 'Payment not completed',
      });
    }

    // Acknowledge so Google Play does not auto-refund the purchase after 3 days.
    // We deliberately DO NOT consume: a code licence must stay in the "owned" state
    // so the buyer can restore it after a reinstall or on a new device.
    if (purchase.acknowledgementState === 0) {
      await acknowledgeProduct({
        productId: product_id,
        purchaseToken: purchase_token,
      });
      console.log(`[Payment] Acknowledged ${product_id}`);
    }

    savePayment({
      orderId: order_id,
      productId: product_id,
      purchaseToken: purchase_token,
      googleOrderId: purchase.orderId ?? google_order_id,
      status: 'Verified_Acknowledged',
      payload: purchase,
    });

    const updatedOrder = order_id ? activateOrder(order_id) : { id: order_id, status: 'Completed' };

    return res.json({
      success: true,
      message: 'Payment verified, acknowledged and code unlocked',
      order: updatedOrder,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: 'Payment verification failed',
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Buy Codes Pro Server running on port ${PORT}`);
  console.log(`Endpoints available:`);
  console.log(`- POST /api/subscription/notify ($5 USD Google Play Subscription verification)`);
  console.log(`- POST /api/payment/notify (One-time IAP product verification)`);
  console.log(`- GET  /api/health`);
});