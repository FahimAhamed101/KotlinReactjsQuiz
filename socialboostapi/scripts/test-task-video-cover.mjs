// Regression: a like task must carry the video it is about, so the card can show it.
//
// The complaint this guards: "show that video in the task for giving likes". A like task
// asks for ONE specific post, and the task card used to show only the account's avatar —
// which says nothing about which video to open. The resource now emits a `post` block
// (cover / url / post_id) for like orders.
//
// The subtlety worth pinning is `postCoverFor`: `orders.image` holds the account avatar
// unless the provider supplied a real cover, so a naive `image` passthrough would show an
// avatar as a video still — and the offline stub's picsum placeholder would be shown as a
// real video. Both are asserted against here.
//
// Read-only. Run with —
//   node --import ./scripts/register-esm-hook.mjs scripts/test-task-video-cover.mjs

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('./load-env.cjs').loadEnv('.env');

const { dbConnect } = await import('../lib/mongodb.js');
await dbConnect();
const db = (await import('../lib/db.js')).default;
const { orderResource } = await import('../lib/resources.js');
const { OrderStatus } = await import('../lib/constants.js');

let pass = 0;
let fail = 0;
function expect(label, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
}

const orders = await db.order.find({
  where: { status: OrderStatus.Progress, deletedAt: null },
  include: { product: { include: { productType: true } }, user: true, account: true },
  limit: 500,
});

const likeOrders = orders.filter((o) => o.isLikes);
const followOrders = orders.filter((o) => !o.isLikes);
console.log(`\n=== ${likeOrders.length} like order(s), ${followOrders.length} follow order(s) ===`);

let covers = 0;
for (const o of likeOrders) {
  const r = orderResource(o, { v4: true });
  const post = r.post;
  const cover = post && post.cover;

  const label = `#${o.id} ${o.platform}`;
  expect(`${label}: like task has a post block`, !!post, JSON.stringify(post));
  if (!post) continue;

  expect(`${label}: post block carries the post url`, typeof post.url === 'string' && post.url.length > 0, post.url);
  expect(
    `${label}: post block carries the post id`,
    typeof post.post_id === 'string' && post.post_id.length > 0,
    String(post.post_id),
  );

  if (cover) {
    covers++;
    expect(`${label}: cover is an absolute url`, /^https?:\/\//.test(cover), cover.slice(0, 60));
    expect(
      `${label}: cover is not the offline placeholder`,
      !cover.includes('picsum.photos'),
      cover.slice(0, 60),
    );
    const avatar = (o.account && o.account.avatarLarger) || null;
    expect(
      `${label}: cover is not just the account avatar`,
      !(avatar && cover === avatar),
      cover.slice(0, 60),
    );
  } else {
    console.log(`       (no still captured for ${label} — the card keeps the avatar)`);
  }
}

// Non-vacuity: if no like order had a cover, every assertion above would pass trivially and
// prove nothing about the extraction.
expect(
  'at least one like order exposes a real still (so the checks are not vacuous)',
  covers > 0,
  `${covers}/${likeOrders.length}`,
);

// Follow tasks must never claim a video.
for (const o of followOrders) {
  const r = orderResource(o, { v4: true });
  expect(`#${o.id} ${o.platform}: follow task has no post block`, r.post === null, JSON.stringify(r.post));
}

console.log(`\nlike orders with a still: ${covers}/${likeOrders.length}`);
console.log(`${fail === 0 ? 'ALL PASS' : `${fail} FAILURE(S)`}  pass=${pass} fail=${fail}\n`);
process.exit(fail === 0 ? 0 : 1);
