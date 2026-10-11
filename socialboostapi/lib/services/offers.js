// Offers.
//
// Ported from App\Services\OfferService.
//
// An Offer ties a Product (category = Offer) to a targeting bitmask, a display
// window, a max claim count and a unique token. Offers are served in DB order —
// there is no random rotation; visibility is purely a set of gates.

import crypto from 'crypto';
import db from '../db';
import { OfferStatus, OfferTargeting } from '../constants';
import { getInt } from '../settings';
import { err } from '../errors';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** True when the offer is inside its active window. Mirrors Offer::isRunning(). */
export function isRunning(offer, now = new Date()) {
  if (offer.status !== OfferStatus.Active) return false;
  if (offer.startDate && offer.startDate > now) return false;
  if (offer.expireDate && offer.expireDate <= now) return false;
  return true;
}

export function isExpired(offer, now = new Date()) {
  return !!offer.expireDate && offer.expireDate <= now;
}

/**
 * Evaluate the targeting bitmask against a user.
 * ALL_USERS short-circuits; otherwise the flags OR together.
 * @see App\Enums\OfferTargetingCriteria
 */
export function userMatchesCriteria(criteria, user, now = new Date()) {
  const has = (flag) => (criteria & flag) === flag;

  if (has(OfferTargeting.ALL_USERS)) return true;

  const created = user.createdAt ? new Date(user.createdAt) : null;
  const lastPurchase = user.lastPurchaseAt ? new Date(user.lastPurchaseAt) : null;
  const lastPremium = user.lastPremiumPurchaseAt ? new Date(user.lastPremiumPurchaseAt) : null;
  const ageMs = created ? now - created : 0;

  const matches = [];

  // FREE_USERS: has bought something, but never a premium order.
  if (has(OfferTargeting.FREE_USERS)) matches.push(!!lastPurchase && !lastPremium);

  // PREMIUM_USERS: has placed a premium order at least once.
  if (has(OfferTargeting.PREMIUM_USERS)) matches.push(!!lastPremium);

  // 30–31 days after a premium purchase.
  if (has(OfferTargeting.OLD_PREMIUM_USER_NO_PREMIUM_ORDER_30_DAYS_AFTER_PREMIUM)) {
    matches.push(
      !!lastPremium &&
        !lastPremium2(lastPremium, now) &&
        now - lastPremium >= 30 * DAY &&
        now - lastPremium < 31 * DAY,
    );
  }

  // 24–48h old account with no premium order.
  if (has(OfferTargeting.NEW_USER_NO_PREMIUM_ORDERS_24_HOURS)) {
    matches.push(!lastPremium && ageMs >= 24 * HOUR && ageMs < 48 * HOUR);
  }

  // 5–6 day old account with no premium order.
  if (has(OfferTargeting.NEW_USER_NO_PREMIUM_ORDER_5_DAYS)) {
    matches.push(!lastPremium && ageMs >= 5 * DAY && ageMs < 6 * DAY);
  }

  // 21–22 days after a premium purchase.
  if (has(OfferTargeting.NO_PREMIUM_ORDER_21_DAYS_AFTER_PREMIUM_ORDER)) {
    matches.push(
      !!lastPremium && now - lastPremium >= 21 * DAY && now - lastPremium < 22 * DAY,
    );
  }

  return matches.some(Boolean);
}

// The 30-day flag means "no *newer* premium order since", which the schema
// tracks with a single timestamp — so there is nothing extra to test.
function lastPremium2() {
  return false;
}

/** How many orders the user has already placed against this offer. */
async function claimedCount(userId, offerId) {
  return db.order.count({ where: { userId, offerId } });
}

export async function hasRemainingClaimAttempts(userId, offer) {
  const claimed = await claimedCount(userId, offer.id);
  return claimed < offer.maxAvail;
}

/** Was the offer displayed to this user recently enough to still be suppressed? */
export async function hasValidDisplayLog(userId, offer, now = new Date()) {
  const windowMs = (await getInt('offer_display_time_in_minutes', 10)) * 60_000;

  const where = { userId, offerId: offer.id };

  // "Multiple" frequency only counts today's displays; anything else uses the window.
  if (offer.notificationFrequency === 2) {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    where.createdAt = { gte: startOfDay };
  } else {
    where.createdAt = { gte: new Date(now.getTime() - windowMs) };
  }

  const hit = await db.userOfferDisplayHistory.findOne({ where, select: { id: true } });
  return !!hit;
}

/**
 * GET /offers — the offers this user may currently see.
 * @see OfferService::getOffersForUser
 */
export async function getOffersForUser(user) {
  const now = new Date();
  const displayTime = await getInt('offer_display_time_in_minutes', 10);

  const offers = await db.offer.find({
    where: { status: OfferStatus.Active },
    include: { product: { include: { productType: true } } },
    sort: { id: 'asc' },
  });

  const visible = [];
  for (const offer of offers) {
    if (!isRunning(offer, now)) continue;

    // Deeplink-gated offers only appear after the deeplink has been followed.
    if (offer.deeplinkEnabled) {
      const arrived = await db.userOfferDeeplinkLog.findOne({
        where: { userId: user.id, offerId: offer.id },
        select: { id: true },
      });
      if (!arrived) continue;
    }

    if (!userMatchesCriteria(offer.targetingCriteria, user, now)) continue;
    if (!(await hasRemainingClaimAttempts(user.id, offer))) continue;
    if (await hasValidDisplayLog(user.id, offer, now)) continue;

    visible.push({ offer, displayTime });
  }

  return visible;
}

/** POST /offers/validate — verify the token and (for deeplink offers) log arrival. */
export async function validateAndLogDeeplink(user, offerId, token) {
  const offer = await db.offer.findOne({ where: { id: Number(offerId) } });
  if (!offer) throw err.offerNotFound('Offer not found.');

  if (!safeEqual(offer.token, token)) throw err.invalidOfferToken('Invalid offer token.');
  if (isExpired(offer)) throw err.offerExpired('Offer expired.');
  if (!userMatchesCriteria(offer.targetingCriteria, user)) {
    throw err.offerNotEligible('You are not eligible for this offer.');
  }
  if (!(await hasRemainingClaimAttempts(user.id, offer))) {
    throw err.offerMaxAvailReached('Offer claim limit reached.');
  }

  if (offer.deeplinkEnabled) {
    await db.userOfferDeeplinkLog.create({ data: { userId: user.id, offerId: offer.id } });
  }

  return null;
}

/** POST /offers/display — record that the offer was shown. */
export async function trackOfferDisplay(user, offerId, token) {
  const offer = await db.offer.findOne({ where: { id: Number(offerId) } });
  if (!offer) throw err.offerNotFound('Offer not found.');
  if (!safeEqual(offer.token, token)) throw err.invalidOfferToken('Invalid offer token.');

  await db.userOfferDisplayHistory.create({
    data: { userId: user.id, offerId: offer.id },
  });

  return null;
}

/**
 * Validate the offer attached to an order being created.
 * Mirrors OfferService::validateOfferProduct.
 */
export async function validateOfferProduct(user, product, offerId = null) {
  const where = { productId: product.id, status: OfferStatus.Active };
  if (offerId) where.id = Number(offerId);

  const offer = await db.offer.findOne({ where, sort: { id: 'asc' } });
  if (!offer) throw err.invalidOffer('No active offer for this product.');
  if (isExpired(offer)) throw err.offerExpired('Offer expired.');
  if (!userMatchesCriteria(offer.targetingCriteria, user)) {
    throw err.offerNotEligible('You are not eligible for this offer.');
  }
  if (await hasValidDisplayLog(user.id, offer)) {
    throw err.offerNotEligible('This offer has already been shown to you.');
  }
  if (!(await hasRemainingClaimAttempts(user.id, offer))) {
    throw err.offerMaxAvailReached('Offer claim limit reached.');
  }

  return offer;
}

/** Offers are minted with a `{id}.{random}` token on create. */
export function mintOfferToken(id) {
  return `${id}.${crypto.randomBytes(8).toString('hex')}`.slice(0, 50);
}

/** Constant-time string compare that tolerates null. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
