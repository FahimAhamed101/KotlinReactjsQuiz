# socialboostapi

The SocialBoost client API, ported from the Laravel backend
(`ttboost/TTBoost-backend`) to Next.js route handlers in JavaScript.

The Android app talks to this service. The response envelope, error codes, field
names and business rules are preserved from the original so the existing client
contract keeps working.

## Quick start

```bash
npm install
npx prisma db push      # create dev.db from the schema
npm run db:seed         # settings, products, an offer, demo user + tasks
npm run dev             # http://localhost:4000
```

Demo login: `id=demo@ttboost.app`, `username=demo_user`.

## Why SQLite

The project ships with SQLite so it runs with no external services. The schema is
written to be portable — switch `provider` in `prisma/schema.prisma` to
`postgresql` or `mysql` for production and re-run `prisma db push`.

## Configuration

See `.env.example`. The two settings that matter for client compatibility:

| Variable | Purpose |
|---|---|
| `HASH_VALUE` | The client sends `hash = sha256(HASH_VALUE)` on login/register. |
| `APP_KEY` | HMAC secret for the `X-Signature` header on every v6 request. |
| `SIGNATURE_ENFORCED` | Set `false` to skip signature checks while developing. |
| `RAPID_API_KEY` | TikTok scraping provider. **Blank uses a deterministic local stub.** |

## Response envelope

Success:

```json
{ "success": true, "data": {} }
```

Error — `message` and `errors` appear only when non-null, matching the Laravel
`array_filter` behaviour:

```json
{ "success": false, "error_code": "CoinsNotEnough", "message": "Not enough coins.", "data": [] }
```

`error_code` is the Laravel enum case name. The full set lives in `lib/errors.js`
and the Android client switches on those exact strings.

## Endpoints

All paths are prefixed `/api`.

| Method | Path | Notes |
|---|---|---|
| GET | `/server-time` | Raw body — **not** wrapped in the envelope. |
| POST | `/v6/login` | Existing users only; unknown id → `UserNotRegistered` 404. |
| POST | `/v6/register` | 409 if the identifier exists; grants welcome bonus. |
| GET | `/v6/me` | `{ user, preferences }`. |
| GET | `/v6/me/orders` | Paginated, V4 resource shape. |
| GET | `/v6/me/history` | Coins ledger, newest first. |
| GET | `/v6/products` | Active General-category products. |
| GET | `/v6/codes` | Source-code catalogue with the **server's** coin price. |
| GET | `/v6/codes/unlocked` | Code ids this account has unlocked with coins. |
| POST | `/v6/codes/unlock` | Spend coins on a code. Idempotent. |
| GET | `/v6/user-info` | Live TikTok profile refresh. |
| GET | `/v6/orders` | The Home task feed → `{ items, has_next, page }`. |
| POST | `/v6/orders` | Create an order (free with coins, or premium → `Pending`). |
| POST | `/v6/orders/skip-count` | Skip a task; reappears until skipped 3×. |
| POST | `/v6/coins/check` | **Verifies a follow/like and credits coins.** |
| GET | `/v6/offers` | Offers this user is eligible to see. |
| POST | `/v6/offers/validate` | Verify offer token; logs deeplink arrival. |
| POST | `/v6/offers/display` | Record a display (suppresses it for 10 min). |
| GET | `/v6/reports` | Paginated reports. |
| POST | `/v6/reports/post` | Submit a report against an order. |

## The follow/like economy

1. **Serve** — `GET /v6/orders` returns other users' in-progress orders. On this
   load the target account's counters are snapshotted into `follow_counts`; that
   snapshot is the anchor the checker compares against.
2. **Act** — the user follows or likes in TikTok.
3. **Verify** — `POST /v6/coins/check` re-reads the target's live `followingCount`
   (or the post's `likeCount`) and credits only if it moved past the anchor.
4. **Credit** — a `coins_histories` row is written, the order's progress bumps,
   the user's balance rises. All in one transaction.

Two rules matter most and are both preserved:

- **Idempotency.** If a `coins_histories` row already exists for
  `(user, order, account)` the response is `{ is_success:false, already:true }` and
  nothing is credited. This is re-checked inside the retry loop.
- **Never credit a first-sight account.** If no `follow_counts` anchor existed,
  the first check only creates one and returns `is_success:false`. Otherwise a
  brand-new account would pay out coins on every task.

## Buying boost packages with coins

`GET /v6/products` returns the Store carousel. A product is one of two kinds,
decided by whether `coins_price` is set:

| `coins_price` | Meaning | What `POST /v6/orders` does |
|---|---|---|
| set | **Free** package, bought from the coin balance | Charges the coins in a transaction, creates a `Progress` order, writes a `coins_histories` row. |
| `null` | **Premium** package, bought with real money via Google Play (`billing_product_id`) | Creates a `Pending` order and charges **no** coins. Released only by `/payment/notify`. |

The Android Store places only the coin kind. It refuses the Play kind with a
message rather than creating a `Pending` order that nothing can ever release,
because `/payment/notify` is not part of this port.

Order creation needs the target TikTok account. `POST /v6/orders` resolves it by
`sec_uid` first, then `username`, then a live profile fetch — so the client sends
**both** to survive a stale `sec_uid`.

### Verifying the flow

```bash
npm run dev
node scripts/test-store-flow.js
```

The script logs in as the seeded demo user (funded) and as a low-balance user,
then asserts: the carousel shape, that a coin order debits exactly the coin
price, that a Play order creates a `Pending` order and leaves coins alone, and
that an unaffordable order is refused with `CoinsNotEnough` without moving the
balance.

## Unlocking source codes with coins

**This part is not in the Laravel original** — it was added because the ported
economy had no payoff. Boost packages create `Progress` orders, but fulfilling
them needs an SMM panel that is not part of this port, so coins bought nothing
real. Codes are the thing the app actually delivers, so they are what coins buy.

Coins are priced at **1 coin = 1 US cent**, so the $6.99 starter costs 699 coins.
A follow pays 5 coins, which puts the cheapest code at roughly 140 follows. Retune
the whole free-vs-paid balance in `prisma/seed.js`; nothing in the client
hardcodes a price.

Three properties matter and each is tested:

- **The server owns the price.** `GET /v6/codes` is the only source. The client
  renders what it is told, so a tampered build cannot unlock a $24.99 codebase
  for 1 coin. Display metadata (images, description, USD price) still comes from
  the portfolio API — this table owns identity and price only.
- **Unlocking is idempotent.** `code_unlocks` has a unique `(user_id, code_id)`, so
  a repeat call returns `already: true` and charges nothing. The check runs twice:
  once before the transaction for a fast path, once inside it so two concurrent
  requests cannot both charge.
- **The spend is in the ledger.** A `coins_histories` row of type `CodeUnlock` is
  written in the same transaction, so `/v6/me/history` shows where the coins went
  instead of them silently vanishing from the balance.

On the client, coin unlocks are stored under a **separate** preference key from
Play purchases. A Play restore rewrites its own set wholesale with what Google
reports, which would otherwise wipe every coin unlock — Play knows nothing about
them. Ownership is the union of the two.

```bash
node scripts/test-code-unlock.js
```

## What is NOT ported

Deliberately out of scope, with reasons:

- **Filament admin panel, RBAC, Pulse/Telescope** — admin-only, no client surface.
- **Google Play purchase verification** (`/coins/purchase`, `/payment/notify`,
  the Pub/Sub receiver). These need a real Play service account and a package
  name. The routes are absent rather than stubbed, so nothing can silently
  "verify" a payment that never happened.
- **Scheduled jobs** — unfollow clawback, pending-order expiry, offer
  notifications, SMM handover. The schema and constants for them exist
  (`unfollow_coins_deductions_cycles`, `OrderPriority`, `UNFOLLOW_TOLERANCE`) but
  no scheduler is wired up. See the porting notes below.
- **Firebase App Check / reCAPTCHA** — feature-flagged off, matching the
  production defaults.

## Known limitations

- **The replay-nonce cache is process-local.** A multi-instance deployment needs
  Redis, exactly as the Laravel original used its cache store.
- **The welcome-bonus slot counter is process-local** for the same reason. It
  fails open, so a restart can only ever grant *more* bonus, never block signup.
- **`lockForUpdate` is approximated** with a Prisma interactive transaction plus a
  re-read. Under real concurrency a serialisable transaction level is the correct
  fix — SQLite serialises writes anyway, Postgres would need `SERIALIZABLE`.
- **The TikTok stub is a development affordance.** With no `RAPID_API_KEY` the
  server derives stable fake profile counts so the flow is exercisable offline.
  Production must set a real key; there is no stub path in the Laravel original.

## Porting gotchas

Things that bit once and are worth not re-introducing:

- **BigInt must be normalised before serializing.** `orders.start_count` and
  `orders.expected_count` are BigInt columns, and `JSON.stringify` throws
  `Do not know how to serialize a BigInt`. Because the order commits *before*
  the resource is serialized, that throw came back as an `Unknown` error — the
  coins were charged and the client was told the order had failed.
  `orderResource` now runs both fields through `jsonSafe()`. The feed route
  happens to dodge this by nulling both fields, which is why the bug hid.
- **`requireString` is strict about types.** `product_id` must be sent as a JSON
  *string*, not a number, or the request 422s.
- **Login needs the `hash` header** (`sha256(HASH_VALUE)`); every other v6 route
  uses the `Authorization` bearer token instead.
