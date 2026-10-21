// ApiErrorCode + ApiException.
//
// Ported from App\Enums\ApiErrorCode and App\Exceptions\ApiException.
// The `error_code` string emitted in the JSON envelope is the enum *case name*,
// so the keys below must stay exactly as they are — the Android client switches on them.

export const ApiErrorCode = {
  WrongHash: 400,
  Validation: 422,
  Unauthorized: 401,
  UserNotFound: 400,
  UserNotRegistered: 404,
  UserAlreadyExists: 409,
  Suspended: 401,
  MissingArgument: 400,
  AlreadyConsumed: 400,
  Unknown: 400,
  OrdersLimitExceeded: 400,
  AccountBanned: 401,
  CantConsume: 400,
  CoinsNotEnough: 400,
  ProductNotFound: 400,
  PaymentFailed: 400,
  ReportAlreadyExists: 400,
  InvalidUsernameOrUrl: 400,
  OrderAlreadyExist: 400,
  OrderNotFound: 404,
  InvalidSignature: 400,
  RequestExpired: 400,
  DuplicateRequest: 400,
  RateLimitExceeded: 429,
  TokenExpired: 401,
  LoginRateLimitExceeded: 429,
  OrderNotDeletable: 400,
  OfferNotFound: 400,
  InvalidOfferToken: 400,
  OfferExpired: 400,
  OfferNotEligible: 400,
  OfferMaxAvailReached: 400,
  InvalidOffer: 400,
  AppCheckTokenMissing: 401,
  AppCheckTokenInvalid: 401,
  CaptchaRequired: 428,
  CaptchaInvalid: 401,
  ServerError: 503,
  ApiDisabled: 400,
  // 409, not 400: this is "already done" rather than "bad input". The client uses it
  // to fall back to the not-yet-available state instead of showing an error about
  // something being wrong with the request.
  DailyBonusClaimed: 409,
};

/** Thrown anywhere in a handler; the wrapper turns it into an error envelope. */
export class ApiException extends Error {
  /**
   * @param {string} code    a key of ApiErrorCode
   * @param {string|null} message
   * @param {number|null} statusCode  defaults to the code's own status
   * @param {any} data
   */
  constructor(code, message = null, statusCode = null, data = []) {
    super(message || code);
    this.name = 'ApiException';
    this.code = code;
    this.statusCode = statusCode ?? ApiErrorCode[code] ?? 400;
    this.data = data;
  }
}

/** Validation failure carrying a per-field error map (Laravel's 422 shape). */
export class ValidationException extends Error {
  constructor(errors) {
    super('Validation');
    this.name = 'ValidationException';
    this.errors = errors;
  }
}

export const err = {
  wrongHash: (m) => new ApiException('WrongHash', m),
  unauthorized: (m) => new ApiException('Unauthorized', m),
  userNotFound: (m) => new ApiException('UserNotFound', m),
  userNotRegistered: (m) => new ApiException('UserNotRegistered', m),
  userAlreadyExists: (m) => new ApiException('UserAlreadyExists', m),
  suspended: (m, data = []) => new ApiException('Suspended', m, 401, data),
  missingArgument: (m) => new ApiException('MissingArgument', m),
  unknown: (m) => new ApiException('Unknown', m),
  productNotFound: (m) => new ApiException('ProductNotFound', m),
  coinsNotEnough: (m) => new ApiException('CoinsNotEnough', m),
  ordersLimitExceeded: (m) => new ApiException('OrdersLimitExceeded', m),
  orderNotFound: (m) => new ApiException('OrderNotFound', m, 404),
  orderNotDeletable: (m) => new ApiException('OrderNotDeletable', m),
  orderAlreadyExist: (m) => new ApiException('OrderAlreadyExist', m),
  accountBanned: (m, data = []) => new ApiException('AccountBanned', m, 401, data),
  offerNotFound: (m) => new ApiException('OfferNotFound', m),
  invalidOfferToken: (m) => new ApiException('InvalidOfferToken', m),
  offerExpired: (m) => new ApiException('OfferExpired', m),
  offerNotEligible: (m) => new ApiException('OfferNotEligible', m),
  offerMaxAvailReached: (m) => new ApiException('OfferMaxAvailReached', m),
  invalidOffer: (m) => new ApiException('InvalidOffer', m),
  paymentFailed: (m) => new ApiException('PaymentFailed', m),
  alreadyConsumed: (m) => new ApiException('AlreadyConsumed', m),
  invalidSignature: (m) => new ApiException('InvalidSignature', m),
  requestExpired: (m) => new ApiException('RequestExpired', m),
  duplicateRequest: (m) => new ApiException('DuplicateRequest', m),
  tokenExpired: (m) => new ApiException('TokenExpired', m, 401),
  reportAlreadyExists: (m) => new ApiException('ReportAlreadyExists', m),
  invalidUsernameOrUrl: (m) => new ApiException('InvalidUsernameOrUrl', m),
  rateLimitExceeded: (m) => new ApiException('RateLimitExceeded', m, 429),
  serverError: (m) => new ApiException('ServerError', m, 503),
  appCheckMissing: (m) => new ApiException('AppCheckTokenMissing', m, 401),
  appCheckInvalid: (m) => new ApiException('AppCheckTokenInvalid', m, 401),
  captchaRequired: (m) => new ApiException('CaptchaRequired', m, 428, [{ captcha_required: true }]),
  captchaInvalid: (m) => new ApiException('CaptchaInvalid', m, 401, [{ captcha_required: true }]),
  apiDisabled: (m) => new ApiException('ApiDisabled', m),
  dailyBonusClaimed: (m) => new ApiException('DailyBonusClaimed', m),
};
