// POST /api/v6/posts/preview
//
// Resolve a pasted link to exactly one post and return everything the order screen needs
// to draw it: the cover, whose video it is, the counters, and which of those counters this
// network actually exposes.
//
// Why this exists: the client used to accept any text, store it as the order target, and
// say nothing else. A buyer pasted a link and had no way to confirm the app had found the
// right video — no thumbnail, no handle, no numbers — until the order failed later with
// "Could not read that video". The store now shows the video before it is bought.
//
// This is a *read*: no baseline row, no order, no coins. The like baseline is still taken
// by POST /posts/url at the moment the task is served, which is the only moment it is
// correct (see the comment there about a fast user liking before the snapshot).
//
// Body: { url, platform }
// Response: { platform, post_pk, url, author, nickname, avatar, cover, desc, counts, orderable }
//
//   `counts`    — every counter, with null where the provider did not return one.
//   `orderable` — the actions whose counter is present. The checker refuses to pay against
//                 a counter it cannot read, so the UI must not offer those either: an
//                 Instagram share, for instance, has no share count to compare.

import { handle, success } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { readJson, requireString } from '@/lib/validate';
import { err } from '@/lib/errors';
import { normalizePlatform, PLATFORM_LABELS } from '@/lib/services/platforms';
import {
  resolvePost,
  canonicalPostUrl,
  getPostInfo,
  postLinkHint,
} from '@/lib/services/posts';

export const dynamic = 'force-dynamic';

export const POST = handle(async (request) => {
  const body = await readJson(request);
  await guard(request, body, { signature: true });

  const raw = requireString(body, 'url', { max: 2048 });
  const platform = normalizePlatform(body.platform);
  const label = PLATFORM_LABELS[platform];

  const post = await resolvePost(platform, raw);
  if (!post?.postId) {
    throw err.unknown(
      `That is not a link to a single ${label} post. ${postLinkHint(platform)}`,
    );
  }

  // The order stores this URL, so the preview must show the same one the order will hold —
  // a short `vm.tiktok.com` link is rebuilt into a canonical `/@user/video/<id>` here, and
  // that resolved id is what gets sent back as `post_pk`.
  const url = canonicalPostUrl(platform, post, raw);
  if (!url) throw err.unknown(`That ${label} link could not be resolved. ${postLinkHint(platform)}`);

  const info = await getPostInfo(platform, url);
  if (!info) {
    throw err.unknown(
      `Could not read that ${label} post. Check the link is public and points at a single video, then try again.`,
    );
  }

  // A stub is a hash of the URL, not a reading of the post. Previewing it would show a made
  // up cover-less "video" with invented numbers and then fail at verification time.
  if (info.isStub) {
    throw err.unknown(
      `No ${label} provider is configured on this server, so this post cannot be previewed.`,
    );
  }

  const counts = {
    like: info.likeCount ?? null,
    comment: info.commentCount ?? null,
    share: info.shareCount ?? null,
    view: info.playCount ?? null,
  };

  return success({
    platform,
    post_pk: String(post.postId),
    url,
    author: info.author ?? post.username ?? null,
    nickname: info.nickname ?? null,
    avatar: info.avatar ?? null,
    cover: info.cover ?? null,
    desc: info.desc ?? null,
    counts,
    orderable: Object.keys(counts).filter((k) => counts[k] !== null),
  });
});