// Seed the database with the settings, product types, products, offers, the
// source-code catalogue and a demo user the Android client needs to run.
//
// Mirrors the Laravel SettingsSeeder + the automatic-offers migration, and the
// the original SQLite seeder — plus an admin account for the panel.
//
// Idempotent: every write is keyed on a natural unique field (email, slug, key,
// oldId, username, name), so re-running never duplicates and never churns ids.

import crypto from 'crypto';
import bcrypt from 'bcryptjs';

import { dbConnect } from './mongodb';
import { nextId } from './models/_base';
import {
  User,
  Account,
  ProductType,
  Product,
  Offer,
  Order,
  FollowCount,
  Code,
  Setting,
  CoinsHistory,
} from './models';

const SETTINGS = {
  referral: 250,
  like: 3,
  follow: 5,
  welcomeBonus: 30,
  maxFullWelcomeBonusPer3Hours: 500,
  reducedWelcomeBonus: 50,
  maxReferralsPerUser: 5,
  premiumLikesOrderBonus: 0.2,
  premiumFollowOrderBonus: 0.5,
  FreeLikesOrderBonus: 0.0,
  FreeFollowOrderBonus: 0.0,
  premiumOrdersPerPage: 10,
  freeOrdersPerPage: 10,
  maxOrdersPerUser: 100,
  maxAccounts: 8,
  allowTestCard: 0,
  waitPerTask: 0,
  maxTaskTry: 2,
  freeOrderRateLimit: 8,
  paidOrderRateLimit: 24,
  loginRateLimit: 60,
  globalRateLimit: 300,
  timeServerRateLimit: 15,
  discountDurationTime: 30,
  tokenExpiresIn: 43200,
  pendingOrderExpiryMinutes: 120,
  maxPendingOrdersPerUser: 100,
  offer_display_time_in_minutes: 10,
  maxFreeOrdersInProgress: 500,
};

// Coins are priced at 1 coin = 1 US cent, so the $6.99 starter costs 699 coins.
// A follow pays 5 coins and a like 3, which puts the cheapest codebase at ~140
// follows — a real grind, but strictly free. Change a number here to retune the
// whole free-vs-paid balance; nothing in the client hardcodes these.
const CODES = [
  ['69b9ef585fe0c15cfbca6d3b', 'Food-Multivendor Restaurant App', 1899],
  ['6984e9b6f026fe71568258a6', 'neibrly Flutter Provider App', 2199],
  ['697d3ed590415b15c3aa2dbd', 'Macbook Store E-Commerce System', 1499],
  ['697d3dc290415b15c3aa2dbc', 'Online Book Shop Application', 1199],
  ['697d3d47ad90aedd55387afe', '.NET Core & Next.js Full-Stack Starter', 699],
  ['690fcd79c0edf355752753fd', 'Flutter Multivendor E-Commerce App', 1999],
  ['690d228feca5e2de5d5ef7d6', 'Flutter News & Article App', 899],
  ['690d075fe59332546baeb0b4', 'Kotlin Native Quiz Pro Application', 1299],
  ['690cee658e96d8a70fe1803f', 'Kotlin Multi-Vendor E-Commerce & Firebase', 2499],
  ['6905319d2c2d2e85ceb41ecb', 'Laravel Full-Featured E-Commerce System', 1699],
  ['68e84de5a5a54f24a2170f43', 'Laravel Multi-Language News Portal', 1199],
  ['681c9dcdf01f9e20b2991b46', 'Lebaba MERN Stack E-Commerce Platform', 1599],
  ['678853f530e5f35b94e1e0df', 'Greatcart Python & Django Store Engine', 1399],
  ['6685b645897ef7ab9f47ae44', 'Upfront React & Django Multi-Vendor Store', 2299],
  ['65e77f03ec80a2fd64c5b16c', 'MERN Stack E-Commerce & Stripe', 1799],
  ['65e604edbf0394fec16562be', 'Real-Time React & Socket.io Chat App', 999],
  ['65e213f64019178ad26e1986', 'Next.js & Prisma Portfolio Platform', 799],
];

/**
 * Idempotent upsert that PRESERVES the numeric id.
 *
 * `Model.updateOne(filter, data, { upsert: true })` would not allocate an `id` — the
 * autoId hook only runs for `save()` and `insertMany()` — so the row would exist with
 * no id and every client request for it would 404. Allocating explicitly, and reusing
 * the existing id on re-run, keeps the seed stable.
 */
// `insertOnly` names fields that are live state rather than configuration. Re-running the
// seeder must not reset them: doing `$set: { coins: 5000 }` on an existing user restored a
// balance the app had already spent, while the ledger kept the spending rows — so the
// panel's drift check fired on a freshly seeded database and looked like a panel bug.
async function upsert(Model, collection, filter, data, { insertOnly = [] } = {}) {
  const existing = await Model.findOne(filter).lean();

  if (existing) {
    const update = { ...data };
    for (const field of insertOnly) delete update[field];
    await Model.updateOne({ id: existing.id }, { $set: update });
    return { ...existing, ...update };
  }

  const id = await nextId(collection);
  const created = await Model.create({ ...filter, ...data, id });
  return created.toObject();
}

// Make a user's ledger explain their balance.
//
// The stored `coins` field is what the app spends; the ledger is the audit trail. The panel
// flags any gap between the two, so demo data has to reconcile or the first thing anyone
// sees is a red "balance drift" banner. Seeding a starting balance without the matching
// ledger row is exactly the kind of gap this closes.
async function reconcileLedger(user) {
  const [totals] = await CoinsHistory.aggregate([
    { $match: { userId: user.id } },
    { $group: { _id: null, gained: { $sum: '$gain' }, lost: { $sum: '$lost' } } },
  ]);

  const net = (totals?.gained ?? 0) - (totals?.lost ?? 0);
  const gap = Number(user.coins ?? 0) - net;
  if (gap === 0) return 0;

  await CoinsHistory.create({
    id: await nextId('coins_histories'),
    userId: user.id,
    type: 'Bonus',
    gain: gap > 0 ? gap : null,
    lost: gap < 0 ? -gap : null,
    count: 1,
  });
  return gap;
}

export async function runSeed() {
  await dbConnect();
  const summary = {};

  // --- Settings ---
  for (const [key, value] of Object.entries(SETTINGS)) {
    await upsert(Setting, 'settings', { key }, { value: String(value) });
  }
  summary.settings = Object.keys(SETTINGS).length;

  // --- Product types ---
  const followers = await upsert(ProductType, 'product_types', { name: 'Followers' }, {});
  const likes = await upsert(ProductType, 'product_types', { name: 'Likes' }, {});
  // Coins packs. Laravel's ProductTypeSeeder has three types; without this one there is
  // nothing for POST /v6/coins/purchase to sell, so "buy coins with money" is unrunnable.
  const coins = await upsert(ProductType, 'product_types', { name: 'Coins' }, {});
  summary.productTypes = 3;

  // --- Products ---
  await Product.updateMany(
    { oldId: { $in: ['free_followers_100', 'free_likes_100', 'premium_followers_1000', 'premium_likes_1000'] } },
    { $set: { isActive: false } }
  );
  // Followers Cash (6 products matching screenshots)
  const followersCash = [
    { oldId: 'tt_follow_200', actionCount: 200, price: '$2.99', billingProductId: 'tt_follow_200', off: null },
    { oldId: 'tt_follow_400', actionCount: 400, price: '$4.99', billingProductId: 'tt_follow_400', off: 17 },
    { oldId: 'tt_follow_900', actionCount: 900, price: '$9.99', billingProductId: 'tt_follow_900', off: 26 },
    { oldId: 'tt_follow_2000', actionCount: 2000, price: '$19.99', billingProductId: 'tt_follow_2000', off: 33 },
    { oldId: 'tt_follow_4300', actionCount: 4300, price: '$39.99', billingProductId: 'tt_follow_4300', off: 38 },
    { oldId: 'tt_follow_9000', actionCount: 9000, price: '$79.99', billingProductId: 'tt_follow_9000', off: 44 },
  ];
  for (const item of followersCash) {
    await upsert(Product, 'products', { oldId: item.oldId }, {
      actionCount: item.actionCount,
      coinsPrice: null,
      price: item.price,
      billingProductId: item.billingProductId,
      productTypeId: followers.id,
      category: 1,
      isActive: true,
      off: item.off,
    });
  }

  // Followers Coins (6 products matching screenshots)
  const followersCoins = [
    { oldId: 'coin_follow_10', actionCount: 10, coinsPrice: 100 },
    { oldId: 'coin_follow_30', actionCount: 30, coinsPrice: 300 },
    { oldId: 'coin_follow_100', actionCount: 100, coinsPrice: 1000 },
    { oldId: 'coin_follow_300', actionCount: 300, coinsPrice: 3000 },
    { oldId: 'coin_follow_1000', actionCount: 1000, coinsPrice: 10000 },
    { oldId: 'coin_follow_2000', actionCount: 2000, coinsPrice: 20000 },
  ];
  for (const item of followersCoins) {
    await upsert(Product, 'products', { oldId: item.oldId }, {
      actionCount: item.actionCount,
      coinsPrice: item.coinsPrice,
      price: null,
      billingProductId: null,
      productTypeId: followers.id,
      category: 1,
      isActive: true,
    });
  }

  // Likes Cash (6 products matching screenshots)
  const likesCash = [
    { oldId: 'tt_like_300', actionCount: 300, price: '$2.99', billingProductId: 'tt_like_300', off: null },
    { oldId: 'tt_like_600', actionCount: 600, price: '$4.99', billingProductId: 'tt_like_600', off: 17 },
    { oldId: 'tt_like_1300', actionCount: 1300, price: '$9.99', billingProductId: 'tt_like_1300', off: 25 },
    { oldId: 'tt_like_2700', actionCount: 2700, price: '$19.99', billingProductId: 'tt_like_2700', off: 29 },
    { oldId: 'tt_like_5600', actionCount: 5600, price: '$39.99', billingProductId: 'tt_like_5600', off: 33 },
    { oldId: 'tt_like_11500', actionCount: 11500, price: '$79.99', billingProductId: 'tt_like_11500', off: 39 },
  ];
  for (const item of likesCash) {
    await upsert(Product, 'products', { oldId: item.oldId }, {
      actionCount: item.actionCount,
      coinsPrice: null,
      price: item.price,
      billingProductId: item.billingProductId,
      productTypeId: likes.id,
      category: 1,
      isActive: true,
      off: item.off,
    });
  }

  // Likes Coins (6 products matching screenshots)
  const likesCoins = [
    { oldId: 'coin_like_10', actionCount: 10, coinsPrice: 80 },
    { oldId: 'coin_like_30', actionCount: 30, coinsPrice: 240 },
    { oldId: 'coin_like_100', actionCount: 100, coinsPrice: 800 },
    { oldId: 'coin_like_200', actionCount: 200, coinsPrice: 1600 },
    { oldId: 'coin_like_500', actionCount: 500, coinsPrice: 4000 },
    { oldId: 'coin_like_1000', actionCount: 1000, coinsPrice: 8000 },
  ];
  for (const item of likesCoins) {
    await upsert(Product, 'products', { oldId: item.oldId }, {
      actionCount: item.actionCount,
      coinsPrice: item.coinsPrice,
      price: null,
      billingProductId: null,
      productTypeId: likes.id,
      category: 1,
      isActive: true,
    });
  }

  // The seeded "discount" offer product.
  const discountProduct = await upsert(
    Product,
    'products',
    { oldId: 'discount' },
    {
      actionCount: 1500,
      coinsPrice: null,
      price: '$9.99',
      billingProductId: 'tt_follow_9_99_discount',
      productTypeId: followers.id,
      category: 2,
      isActive: true,
      off: 50,
    },
  );
  // Coin packs — bought with money, paid out as coins by POST /v6/coins/purchase.
  // Product ids and pack sizes are taken verbatim from Laravel's ProductsSeeder so the
  // client's product ids keep resolving; `actionCount` is the number of coins granted.
  await upsert(
    Product,
    'products',
    { oldId: 'IwT1FZZTItsoozN26Rss' },
    {
      actionCount: 50000,
      coinsPrice: null,
      price: '$49.99',
      billingProductId: 'tt_coin_99_99',
      productTypeId: coins.id,
      category: 1,
      isActive: true,
      off: 39,
    },
  );

  await upsert(
    Product,
    'products',
    { oldId: 'ucCHf9VAs9xuPrqYJRT9' },
    {
      actionCount: 17000,
      coinsPrice: null,
      price: '$19.99',
      billingProductId: 'tt_coin_19_99',
      productTypeId: coins.id,
      category: 1,
      isActive: true,
      off: 27,
    },
  );
  summary.products = 7;

  // --- Offer ---
  // targeting_criteria 16|32|64 = 112, exactly as the Laravel migration seeds.
  await upsert(
    Offer,
    'offers',
    { name: 'Default Offer' },
    {
      productId: discountProduct.id,
      targetingCriteria: 112,
      notificationFrequency: 1,
      expireDate: new Date('2037-12-31T00:00:00Z'),
      notificationEnabled: true,
      deeplinkEnabled: false,
      status: 'active',
      maxAvail: 999,
      token: `1.${crypto.randomBytes(8).toString('hex')}`.slice(0, 50),
    },
  );
  summary.offers = 1;

  // --- Admin account (panel login) ---
  // The mobile client never checks a password, so the panel gets its own bcrypt hash
  // in a separate field. Log in with these credentials at /admin/login.
  const adminEmail = process.env.ADMIN_SEED_EMAIL || 'admin@ttboost.app';
  const adminPassword = process.env.ADMIN_SEED_PASSWORD || 'admin12345';
  const existingAdmin = await User.findOne({ email: adminEmail }).select('+adminPasswordHash').lean();

  if (!existingAdmin) {
    const id = await nextId('users');
    await User.create({
      id,
      email: adminEmail,
      password: adminEmail, // vestigial, matches the upstream NOT NULL column
      adminPasswordHash: await bcrypt.hash(adminPassword, 10),
      name: 'Panel Admin',
      isAdmin: true,
      coins: 0,
      status: 'Active',
    });
  } else if (!existingAdmin.adminPasswordHash) {
    await User.updateOne(
      { id: existingAdmin.id },
      { $set: { adminPasswordHash: await bcrypt.hash(adminPassword, 10), isAdmin: true } },
    );
  }
  summary.admin = adminEmail;

  // --- Demo user ---
  // Login with id = "demo@ttboost.app", username = "demo_user".
  // `coins` is insert-only: once the demo user exists, their balance belongs to the app.
  const demo = await upsert(
    User,
    'users',
    { email: 'demo@ttboost.app' },
    { password: 'demo@ttboost.app', name: 'Demo User', coins: 5000, status: 'Active' },
    { insertOnly: ['coins'] },
  );

  await upsert(
    Account,
    'accounts',
    { username: 'demo_user' },
    {
      nickname: 'Demo User',
      secUid: 'MS4wLjABAAAAdemo0000000000000000',
      tiktokId: '7000000000000000001',
      avatarLarger: 'https://picsum.photos/seed/demo_user/200',
      avatarMedium: 'https://picsum.photos/seed/demo_user/100',
      avatarThumb: 'https://picsum.photos/seed/demo_user/50',
      following: 250,
      follower: 1200,
      region: 'US',
    },
  );
  summary.demoUser = demo.id;

  // The end-to-end suites spend real coins through the public API (a code unlock costs
  // 799), so after a few runs the demo account is broke and the demo dataset is no longer
  // presentable — or testable. Top up to the floor and let reconcileLedger record the
  // credit, so drift stays at zero and the panel always shows a healthy demo user.
  const DEMO_STARTING_COINS = 5000;
  if (Number(demo.coins ?? 0) < DEMO_STARTING_COINS) {
    await User.updateOne({ id: demo.id }, { $set: { coins: DEMO_STARTING_COINS } });
    demo.coins = DEMO_STARTING_COINS;
  }

  // Credit the starting balance to the ledger, so the coins ledger and the panel's ledger
  // screen have a real row and the demo user reconciles instead of reporting drift.
  summary.demoLedgerGap = await reconcileLedger(demo);

  // --- Demo tasks ---
  // A handful of other users' in-progress orders so the Home feed has content.
  //
  // Each task is keyed on (userId, url) rather than guarded by a single
  // `countDocuments({ type: 'Free' }) === 0` check. An all-or-nothing guard is not
  // idempotent in the way that actually matters: if the loop dies partway through —
  // and it did, on a duplicate-key error creating the second order — the partial
  // state makes the guard false forever, so the remaining tasks are never created
  // and every later run silently reports success. Per-task keys let a re-run finish
  // the job, and make the reported count honest.
  const targets = ['creator_anna', 'fitness_raj', 'daily_vlog_max', 'chef_lina', 'tech_with_sam'];
  let demoTasksCreated = 0;

  for (let i = 0; i < targets.length; i++) {
    const username = targets[i];
    const owner = await upsert(
      User,
      'users',
      { email: `owner${i}@ttboost.app` },
      { password: `owner${i}@ttboost.app`, name: username, coins: 1000, status: 'Active' },
      { insertOnly: ['coins'] },
    );
    // Same reasoning as the demo user: a balance with no ledger row shows up as drift.
    await reconcileLedger(owner);

    const account = await upsert(
      Account,
      'accounts',
      { username },
      {
        nickname: username,
        secUid: `MS4wLjABAAAA${username}`,
        avatarLarger: `https://picsum.photos/seed/${username}/200`,
        following: 100 + i * 17,
        follower: 900 + i * 130,
      },
    );

    const useLikes = i % 2 === 1;
    const url = useLikes
      ? `https://www.tiktok.com/@${username}/video/73000000000000000${i}`
      : `https://www.tiktok.com/@${username}`;

    const existingTask = await Order.findOne({ userId: owner.id, url }).lean();
    if (!existingTask) {
      await Order.create({
        id: await nextId('orders'),
        userId: owner.id,
        productId: (useLikes ? freeLikes : freeFollowers).id,
        accountId: account.id,
        image: account.avatarLarger,
        username,
        url,
        postPk: useLikes ? `73000000000000000${i}` : null,
        startCount: 1000 + i * 50,
        expectedCount: 1100 + i * 50,
        status: 'Progress',
        type: 'Free',
        currentProgress: 0,
        maxProgress: 100,
        actualMaxProgress: 100,
        isLikes: useLikes,
        priority: 3,
      });
      demoTasksCreated++;
    }

    await upsert(
      FollowCount,
      'follow_counts',
      { username },
      {
        followingCount: 100 + i * 17,
        followerCount: 900 + i * 130,
        lastCheckedFollowing: 100 + i * 17,
        accountId: account.id,
      },
    );
  }
  summary.demoTasks = demoTasksCreated;

  // --- Source-code catalogue ---
  for (const [slug, title, coinsPrice] of CODES) {
    await upsert(Code, 'codes', { slug }, { title, coinsPrice, isActive: true });
  }
  summary.codes = CODES.length;

  // --- Report what is actually in the database now ---
  summary.counts = {
    users: await User.countDocuments(),
    accounts: await Account.countDocuments(),
    products: await Product.countDocuments(),
    orders: await Order.countDocuments(),
    codes: await Code.countDocuments(),
    settings: await Setting.countDocuments(),
    coinsHistories: await CoinsHistory.countDocuments(),
  };

  return summary;
}

export default runSeed;
