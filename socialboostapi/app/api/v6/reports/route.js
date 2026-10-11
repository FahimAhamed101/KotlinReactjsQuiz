// GET  /api/v6/reports — the user's submitted reports
// POST /api/v6/reports/post — submit a report against an order
//
// Ported from ReportController::index / ::store -> ReportService.

import { handle, paginate } from '@/lib/envelope';
import { guard } from '@/lib/guard';
import { err } from '@/lib/errors';
import { reportResource } from '@/lib/resources';
import { readJson, requireInt, requireString, tiktokUsername, optionalString, pageOf } from '@/lib/validate';
import { resolveAccount } from '@/lib/services/coinsCheck';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

const PER_PAGE = 30;

export const GET = handle(async (request) => {
  await guard(request, {}, { signature: true });
  const page = pageOf(request, 1);

  const [rows, total] = await Promise.all([
    db.report.find({
      include: { order: { include: { product: { include: { productType: true } }, user: true } }, account: true },
      sort: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      limit: PER_PAGE,
    }),
    db.report.count(),
  ]);

  return paginate(rows.map(reportResource), { page, perPage: PER_PAGE, total });
});

export const POST = handle(async (request) => {
  const body = await readJson(request);
  const user = await guard(request, body, { signature: true });

  optionalString(body, 'sec_uid', { max: 255 });
  tiktokUsername(body, 'username', { required: false });
  const type = requireString(body, 'type', { max: 255 });
  const details = optionalString(body, 'details', { max: 2000 });
  const orderId = requireInt(body, 'order_id');

  const account = await resolveAccount(body);
  if (!account) throw err.userNotFound('Account not found.');

  const existing = await db.report.findOne({
    where: { accountId: account.id, orderId },
  });
  if (existing) throw err.reportAlreadyExists('You have already reported this order.');

  const order = await db.order.findOne({ where: { id: orderId } });
  if (!order) throw err.orderNotFound('Order not found.');

  return db.report.create({
    data: { accountId: account.id, type, details, orderId, status: 'pending' },
    include: { order: true, account: true },
  });
});
