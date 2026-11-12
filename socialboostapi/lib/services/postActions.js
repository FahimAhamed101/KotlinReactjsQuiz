// Post-anchored actions: which counter proves the action, and what it pays.
//
// This stack has exactly one verification mechanism: snapshot a counter on the target
// before the task is performed, then credit only when the live counter has risen. There is
// no OAuth and no per-user analytics, so an action is only verifiable if its provider
// exposes a counter that the action moves.
//
// That constraint is the whole design here. An action whose counter the provider does not
// return is **refused**, never paid on trust — the alternative is the free-coins bug class
// this port has already been bitten by twice (a stub profile and a zero baseline).
//
// Verified live on 2026-11-13 against the configured TikTok scraper:
//   digg_count = 1, comment_count = 0, share_count = 0, play_count = 95
// Instagram exposes comment counts but no share count; Facebook exposes both.

export const ActionType = {
  Follow: 'follow',
  Like: 'like',
  Share: 'share',
  Comment: 'comment',
  View: 'view',
};

/**
 * The four post actions.
 *
 * `metric`  — the field `getPostInfo` must return for this action.
 * `setting` — the settings key holding the coin reward (see lib/settings.js DEFAULTS).
 * `task`    — the coins_histories type written when a performer is credited.
 * `order`   — the coins_histories type written when the buyer pays.
 */
export const POST_ACTIONS = {
  [ActionType.Like]: { metric: 'likeCount', setting: 'like', task: 'LikeTask', order: 'LikesOrder' },
  [ActionType.Share]: { metric: 'shareCount', setting: 'share', task: 'ShareTask', order: 'SharesOrder' },
  [ActionType.Comment]: { metric: 'commentCount', setting: 'comment', task: 'CommentTask', order: 'CommentsOrder' },
  [ActionType.View]: { metric: 'playCount', setting: 'view', task: 'ViewTask', order: 'ViewsOrder' },
};

/** Every coins_histories type that represents *performing* a task. */
export const TASK_HISTORY_TYPES = [
  'FollowTask',
  ...Object.values(POST_ACTIONS).map((a) => a.task),
];

/** Every coins_histories type that represents *buying* a package. */
export const ORDER_HISTORY_TYPES = [
  'FollowersOrder',
  ...Object.values(POST_ACTIONS).map((a) => a.order),
];

export function normalizeAction(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(POST_ACTIONS, v) ? v : null;
}

/** True when the action is anchored to one post rather than the whole profile. */
export function isPostAction(action) {
  return Object.prototype.hasOwnProperty.call(POST_ACTIONS, String(action ?? '').toLowerCase());
}

/**
 * The action an order represents.
 *
 * `actionType` is authoritative. Rows written before it existed carry only the `isLikes`
 * boolean, so that is the fallback — and a missing boolean means Follow, exactly as the
 * original Laravel schema implied.
 */
export function actionOfOrder(order) {
  const explicit = normalizeAction(order?.actionType);
  if (explicit) return explicit;
  return order?.isLikes ? ActionType.Like : ActionType.Follow;
}

/** True when this order targets a single post (like / share / comment / view). */
export function isPostOrder(order) {
  return isPostAction(actionOfOrder(order));
}

export function metricFor(action) {
  return POST_ACTIONS[normalizeAction(action)]?.metric ?? null;
}

export function settingFor(action) {
  return POST_ACTIONS[normalizeAction(action)]?.setting ?? null;
}

export function taskHistoryType(action) {
  const a = normalizeAction(action);
  if (a) return POST_ACTIONS[a].task;
  return action === ActionType.Follow ? 'FollowTask' : null;
}

export function orderHistoryType(action) {
  const a = normalizeAction(action);
  if (a) return POST_ACTIONS[a].order;
  return action === ActionType.Follow ? 'FollowersOrder' : null;
}

/**
 * The counter that proves this action, or null when the provider did not return one.
 *
 * Returning null — never 0 — is load-bearing. A missing counter means "we cannot see it",
 * and the caller must refuse to pay. Coercing it to 0 would make the very next reading look
 * like a rise from zero, which is how a provider outage once paid out for likes nobody gave.
 */
export function metricValue(post, action) {
  const key = metricFor(action);
  if (!key || !post) return null;
  const v = post[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Map a product type name ("Likes", "Comments", …) onto an action. */
export function actionFromProductType(name) {
  const t = String(name ?? '').toLowerCase();
  if (!t) return null;
  // "followers" contains "follow", so this is tested before anything else.
  if (t.includes('follower') || t.includes('follow')) return ActionType.Follow;
  if (t.includes('like')) return ActionType.Like;
  if (t.includes('share')) return ActionType.Share;
  if (t.includes('comment')) return ActionType.Comment;
  if (t.includes('view') || t.includes('play')) return ActionType.View;
  return null;
}
