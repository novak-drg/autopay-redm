import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { requireAdminSession } from './adminAuth.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PeriodSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
}).refine(d => d.from <= d.to, 'from must be <= to');

const parsePeriod = (query: Record<string, unknown>) => {
  const now = new Date();
  const from = (query.from as string) || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to = (query.to as string) || now.toISOString().slice(0, 10);
  return PeriodSchema.parse({ from, to });
};

// ─── Router ───────────────────────────────────────────────────────────────────

export const adminAnalyticsRouter = Router();
adminAnalyticsRouter.use(requireAdminSession);

// GET /v1/admin/analytics/overview
// KPIs: total revenue, transaction count, avg ticket, paid count, pending count
adminAnalyticsRouter.get('/overview', async (req: Request, res: Response) => {
  const { from, to } = parsePeriod(req.query as Record<string, unknown>);

  const [stats] = await db.query<{
    total_revenue: string; paid_count: string;
    pending_count: string; avg_ticket: string;
    total_transactions: string;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status='PAID' THEN amount_cents ELSE 0 END), 0) AS total_revenue,
       COUNT(CASE WHEN status='PAID' THEN 1 END)                              AS paid_count,
       COUNT(CASE WHEN status='PENDING' THEN 1 END)                           AS pending_count,
       COALESCE(AVG(CASE WHEN status='PAID' THEN amount_cents END), 0)        AS avg_ticket,
       COUNT(*)                                                                AS total_transactions
     FROM pix_charges
     WHERE DATE(created_at) BETWEEN ? AND ?`,
    [from, to]
  );

  // Previous period for growth comparison
  const diffDays = Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
  const prevTo = new Date(from); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - diffDays);

  const [prev] = await db.query<{ total_revenue: string; paid_count: string }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status='PAID' THEN amount_cents ELSE 0 END), 0) AS total_revenue,
       COUNT(CASE WHEN status='PAID' THEN 1 END) AS paid_count
     FROM pix_charges
     WHERE DATE(created_at) BETWEEN ? AND ?`,
    [prevFrom.toISOString().slice(0, 10), prevTo.toISOString().slice(0, 10)]
  );

  const revenueGrowth = Number(prev.total_revenue) > 0
    ? ((Number(stats.total_revenue) - Number(prev.total_revenue)) / Number(prev.total_revenue)) * 100
    : null;

  res.json({
    period: { from, to },
    totalRevenueCents: Number(stats.total_revenue),
    paidCount: Number(stats.paid_count),
    pendingCount: Number(stats.pending_count),
    avgTicketCents: Math.round(Number(stats.avg_ticket)),
    totalTransactions: Number(stats.total_transactions),
    revenueGrowthPct: revenueGrowth !== null ? Math.round(revenueGrowth * 10) / 10 : null,
  });
});

// GET /v1/admin/analytics/sales-by-hour
adminAnalyticsRouter.get('/sales-by-hour', async (req: Request, res: Response) => {
  const { from, to } = parsePeriod(req.query as Record<string, unknown>);

  const rows = await db.query<{ hour: number; count: string; revenue: string }>(
    `SELECT
       HOUR(updated_at) AS hour,
       COUNT(*)      AS count,
       SUM(amount_cents) AS revenue
     FROM pix_charges
     WHERE status = 'PAID'
       AND DATE(updated_at) BETWEEN ? AND ?
     GROUP BY HOUR(updated_at)
     ORDER BY hour ASC`,
    [from, to]
  );

  const data = Array.from({ length: 24 }, (_, i) => {
    const found = rows.find(r => Number(r.hour) === i);
    return { hour: i, count: Number(found?.count ?? 0), revenueCents: Number(found?.revenue ?? 0) };
  });

  res.json({ period: { from, to }, data });
});

// GET /v1/admin/analytics/sales-by-weekday
adminAnalyticsRouter.get('/sales-by-weekday', async (req: Request, res: Response) => {
  const { from, to } = parsePeriod(req.query as Record<string, unknown>);

  const rows = await db.query<{ weekday: number; count: string; revenue: string }>(
    `SELECT
       DAYOFWEEK(updated_at) AS weekday,
       COUNT(*)           AS count,
       SUM(amount_cents)  AS revenue
     FROM pix_charges
     WHERE status = 'PAID'
       AND DATE(updated_at) BETWEEN ? AND ?
     GROUP BY DAYOFWEEK(updated_at)
     ORDER BY weekday ASC`,
    [from, to]
  );

  const names = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const data = Array.from({ length: 7 }, (_, i) => {
    const found = rows.find(r => Number(r.weekday) === i + 1);
    return {
      weekday: i + 1,
      name: names[i],
      count: Number(found?.count ?? 0),
      revenueCents: Number(found?.revenue ?? 0),
    };
  });

  res.json({ period: { from, to }, data });
});

// GET /v1/admin/analytics/revenue-by-period?groupBy=day|week|month
adminAnalyticsRouter.get('/revenue-by-period', async (req: Request, res: Response) => {
  const { from, to } = parsePeriod(req.query as Record<string, unknown>);
  const groupByRaw = req.query.groupBy as string;
  const groupBy = ['day', 'week', 'month'].includes(groupByRaw) ? groupByRaw : 'day';

  const groupExpr = groupBy === 'day' ? 'DATE(updated_at)'
    : groupBy === 'week' ? 'YEARWEEK(updated_at, 1)'
      : "DATE_FORMAT(updated_at, '%Y-%m')";

  const rows = await db.query<{ period_key: string; count: string; revenue: string }>(
    `SELECT
       ${groupExpr} AS period_key,
       COUNT(*)     AS count,
       SUM(amount_cents) AS revenue
     FROM pix_charges
     WHERE status = 'PAID'
       AND DATE(updated_at) BETWEEN ? AND ?
     GROUP BY ${groupExpr}
     ORDER BY period_key ASC`,
    [from, to]
  );

  res.json({
    period: { from, to },
    groupBy,
    data: rows.map(r => ({
      key: String(r.period_key),
      count: Number(r.count),
      revenueCents: Number(r.revenue),
    })),
  });
});

// GET /v1/admin/analytics/product-ranking
adminAnalyticsRouter.get('/product-ranking', async (req: Request, res: Response) => {
  const { from, to } = parsePeriod(req.query as Record<string, unknown>);

  const rows = await db.query<{ product_id: string; count: string; revenue: string }>(
    `SELECT
       product_id,
       COUNT(*)          AS count,
       SUM(amount_cents) AS revenue
     FROM pix_charges
     WHERE status = 'PAID'
       AND DATE(updated_at) BETWEEN ? AND ?
     GROUP BY product_id
     ORDER BY revenue DESC
     LIMIT 20`,
    [from, to]
  );

  res.json({
    period: { from, to },
    data: rows.map(r => ({
      productId: r.product_id,
      count: Number(r.count),
      revenueCents: Number(r.revenue),
    })),
  });
});

// GET /v1/admin/analytics/comparison
adminAnalyticsRouter.get('/comparison', async (req: Request, res: Response) => {
  const { from, to } = parsePeriod(req.query as Record<string, unknown>);

  const diffDays = Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
  const prevTo = new Date(from); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - diffDays);
  const pf = prevFrom.toISOString().slice(0, 10);
  const pt = prevTo.toISOString().slice(0, 10);

  const snapshot = async (f: string, t: string) =>
    db.query<{ revenue: string; count: string; avg: string }>(
      `SELECT
         COALESCE(SUM(amount_cents), 0) AS revenue,
         COUNT(*) AS count,
         COALESCE(AVG(amount_cents), 0) AS avg
       FROM pix_charges
       WHERE status='PAID' AND DATE(updated_at) BETWEEN ? AND ?`,
      [f, t]
    ).then(r => r[0]);

  const [curr, prev] = await Promise.all([snapshot(from, to), snapshot(pf, pt)]);

  const growth = (c: number, p: number) =>
    p > 0 ? Math.round(((c - p) / p) * 1000) / 10 : null;

  res.json({
    current: { from, to, revenueCents: Number(curr.revenue), count: Number(curr.count), avgCents: Math.round(Number(curr.avg)) },
    previous: { from: pf, to: pt, revenueCents: Number(prev.revenue), count: Number(prev.count), avgCents: Math.round(Number(prev.avg)) },
    growth: {
      revenuePct: growth(Number(curr.revenue), Number(prev.revenue)),
      countPct: growth(Number(curr.count), Number(prev.count)),
      avgPct: growth(Number(curr.avg), Number(prev.avg)),
    },
  });
});

// GET /v1/admin/transactions?page=1&perPage=25&status=PAID&from=...&to=...
adminAnalyticsRouter.get('/transactions', async (req: Request, res: Response) => {
  const { from, to } = parsePeriod(req.query as Record<string, unknown>);
  const page = Math.max(1, parseInt(req.query.page as string ?? '1', 10));
  const perPage = Math.min(100, Math.max(1, parseInt(req.query.perPage as string ?? '25', 10)));
  const offset = (page - 1) * perPage;

  const ALLOWED_STATUSES = ['PAID', 'PENDING', 'EXPIRED', 'FAILED', 'CANCELED', 'CREATED'];
  const status = ALLOWED_STATUSES.includes(req.query.status as string)
    ? req.query.status as string
    : null;

  const statusClause = status ? 'AND status = ?' : '';
  const params = status ? [from, to, status, perPage, offset] : [from, to, perPage, offset];

  const [{ total }] = await db.query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM pix_charges WHERE DATE(created_at) BETWEEN ? AND ? ${statusClause}`,
    status ? [from, to, status] : [from, to]
  );

  const rows = await db.query(
    `SELECT internal_charge_id AS charge_id, player_identifier, product_id, amount_cents,
            currency, status, created_at, updated_at AS paid_at, expires_at
     FROM pix_charges
     WHERE DATE(created_at) BETWEEN ? AND ? ${statusClause}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    params
  );

  res.json({
    page,
    perPage,
    total: Number(total),
    totalPages: Math.ceil(Number(total) / perPage),
    data: rows,
  });
});

// DELETE /v1/admin/transactions/:id — remove permanentemente
adminAnalyticsRouter.delete('/transactions/:id', async (req: Request, res: Response) => {
  const chargeId = req.params.id?.trim();
  if (!chargeId) { res.status(400).json({ error: 'invalid_id' }); return; }

  const [row] = await db.query<{ id: number }>(
    'SELECT id FROM pix_charges WHERE internal_charge_id = ? LIMIT 1', [chargeId]
  );
  if (!row) { res.status(404).json({ error: 'not_found' }); return; }

  await db.query('DELETE FROM pix_charges WHERE internal_charge_id = ?', [chargeId]);
  res.json({ ok: true });
});

// POST /v1/admin/transactions/:id/approve — aprovação manual (marca como PAID)
adminAnalyticsRouter.post('/transactions/:id/approve', async (req: Request, res: Response) => {
  const chargeId = req.params.id?.trim();
  if (!chargeId) { res.status(400).json({ error: 'invalid_id' }); return; }

  const [row] = await db.query<{ id: number; status: string; player_identifier: string; product_id: string; amount_cents: number }>(
    'SELECT id, status, player_identifier, product_id, amount_cents FROM pix_charges WHERE internal_charge_id = ? LIMIT 1',
    [chargeId]
  );
  if (!row) { res.status(404).json({ error: 'not_found' }); return; }
  if (row.status === 'PAID') { res.status(409).json({ error: 'already_paid' }); return; }

  await db.query(
    `UPDATE pix_charges SET status = 'PAID', updated_at = NOW() WHERE internal_charge_id = ?`,
    [chargeId]
  );
  res.json({ ok: true, chargeId });
});
