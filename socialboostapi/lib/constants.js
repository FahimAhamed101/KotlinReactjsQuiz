// Shared domain constants.
//
// Ported from the Laravel enums (App\Enums\*). Only the *values* matter to the
// client API — the Filament label/colour/icon contracts are admin-only and dropped.

/**
 * orders.status
 *
 * Laravel spells the cancelled case with a **double L** (`OrderStatus::Cancelled`)
 * and OrderResource passes the raw value straight through to the client, so that
 * is the value this port must write and emit.
 *
 * `Canceled` (single L) is kept as an alias pointing at the same canonical string.
 * An earlier build of this port wrote the single-L spelling, so rows created by it
 * are still in the database; because the alias resolves to `'Cancelled'`, those
 * rows keep comparing equal to every `OrderStatus.Canceled` site in this codebase.
 */
export const OrderStatus = {
  Pending: 'Pending',
  InQueue: 'InQueue',
  Progress: 'Progress',
  Completed: 'Completed',
  Cancelled: 'Cancelled',
  Canceled: 'Cancelled',
  Deleted: 'Deleted',
  SmmPanel: 'SmmPanel',
};

/**
 * Every spelling of "cancelled" seen in the wild, for code that compares against
 * a raw value read out of the database rather than against `OrderStatus`.
 */
export const CANCELLED_STATUSES = ['Cancelled', 'Canceled'];

/** True for any spelling of the cancelled status. */
export function isCancelledStatus(status) {
  return CANCELLED_STATUSES.includes(status);
}

/** orders.type */
export const OrderType = {
  Special: 'Special',
  Free: 'Free',
  Premium: 'Premium',
};

/** orders.priority — Low sorts after Normal. */
export const OrderPriority = {
  Normal: 3,
  Low: 5,
};

/** coins_histories.type */
export const CoinHistoryType = {
  Bonus: 'Bonus',
  Referral: 'Referral',
  FollowTask: 'FollowTask',
  LikeTask: 'LikeTask',
  CoinsOrder: 'CoinsOrder',
  Spin: 'Spin',
  Unfollow: 'Unfollow',
  FollowersOrder: 'FollowersOrder',
  LikesOrder: 'LikesOrder',
  // Not in the Laravel original — added so spending coins on a source code shows
  // up in the ledger instead of vanishing from the user's history.
  CodeUnlock: 'CodeUnlock',
  // Also not in the original: the free daily claim. Kept as its own type so the daily
  // streak and the one-per-day rule are readable straight off the ledger.
  DailyBonus: 'DailyBonus',
};

/** products.category */
export const ProductCategory = {
  General: 1,
  Offer: 2,
};

/**
 * offers.status
 * @see offers.status enum('pending','active','canceled','expired')
 */
export const OfferStatus = {
  Pending: 'pending',
  Active: 'active',
  Canceled: 'canceled',
  Expired: 'expired',
};

/**
 * Offer targeting criteria — a bitmask with OR semantics.
 * ALL_USERS short-circuits every other flag.
 * @see App\Enums\OfferTargetingCriteria
 */
export const OfferTargeting = {
  ALL_USERS: 1,
  FREE_USERS: 2,
  PREMIUM_USERS: 4,
  OLD_PREMIUM_USER_NO_PREMIUM_ORDER_30_DAYS_AFTER_PREMIUM: 8,
  NEW_USER_NO_PREMIUM_ORDERS_24_HOURS: 16,
  NEW_USER_NO_PREMIUM_ORDER_5_DAYS: 32,
  NO_PREMIUM_ORDER_21_DAYS_AFTER_PREMIUM_ORDER: 64,
};

/**
 * orders.reason — App\Enums\OrderCancelCode.
 * The raw string values matter: they are compared against orders.reason in the
 * database and surfaced to the client.
 */
export const OrderCancelCode = {
  UnavailableVideo: 'Unavailable_Video',
  UnavailableAccount: 'Unavailable_Account',
  Refunded: 'Refunded',
  MultipleAccounts: 'Multiple_Accounts_Detected',
  AccountPrivate: 'Account_Private',
  LowCompletionRate: 'Low_Completion_Rate',
  CanceledByAdmin: 'Canceled_By_Admin',
  BillingInitiatedButNotProceed: 'Billing_Initiated_But_Not_Proceed',
  FreeOrderLimit: 'Free_Order_Limit',
};

/**
 * Free-text reasons written before the enum existed, mapped to their code.
 * Mirrors Order::normalizedCancelReason().
 */
const LEGACY_CANCEL_REASONS = {
  'Video is unavailable': OrderCancelCode.UnavailableVideo,
  'Video is unavailable. Maybe it has been removed or account is private.':
    OrderCancelCode.UnavailableVideo,
  'Profile is unavailable': OrderCancelCode.UnavailableAccount,
  'Account is private.': OrderCancelCode.AccountPrivate,
  'Low completion rate': OrderCancelCode.LowCompletionRate,
};

/** Normalise a stored reason to its cancel code. Mirrors Order::normalizedCancelReason(). */
export function normalizedCancelReason(reason) {
  if (reason === null || reason === undefined || reason === '') return null;
  return LEGACY_CANCEL_REASONS[String(reason)] ?? String(reason);
}

/**
 * Only these cancellations may be reactivated. Mirrors
 * Order::reactivatableSystemReasons() — note this is an allowlist, so a reason
 * that is neither blocked nor listed here is also refused.
 */
export const REACTIVATABLE_SYSTEM_REASONS = [
  OrderCancelCode.UnavailableVideo,
  OrderCancelCode.UnavailableAccount,
  OrderCancelCode.AccountPrivate,
  OrderCancelCode.LowCompletionRate,
];

/** Hard blocks, checked before the allowlist. Mirrors Order::blockedReactivationReasons(). */
export const BLOCKED_REACTIVATION_REASONS = [
  OrderCancelCode.Refunded,
  OrderCancelCode.MultipleAccounts,
  OrderCancelCode.CanceledByAdmin,
  OrderCancelCode.BillingInitiatedButNotProceed,
  OrderCancelCode.FreeOrderLimit,
];

/** Cancellation reason set when a pending unpaid order expires or is deleted. */
export const REASON_BILLING_NOT_PROCEEDED = OrderCancelCode.BillingInitiatedButNotProceed;

/** Tolerance applied when computing unfollow clawbacks. */
export const UNFOLLOW_TOLERANCE = 3;

/** Hardcoded billing product for the spin wheel (was inline in CoinsController). */
export const SPIN_BILLING_PRODUCT_ID = 'ib_spin_2_99';
