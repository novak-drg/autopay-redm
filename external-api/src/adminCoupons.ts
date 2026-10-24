import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { db } from './db.js';
import { requireAdminSession } from './adminAuth.js';
import { pushCatalogToFivem } from './catalogPush.js';

const router = Router();
router.use(requireAdminSession);

// ─────────────────────────────────────────────────────────────────────────────
// Validation schemas
// ─────────────────────────────────────────────────────────────────────────────

const CODE_PATTERN = /^[A-Z0-9_-]{2,50}$/;

const CouponSchema = z.object({
  code:                        z.string().regex(CODE_PATTERN, 'code: apenas A-Z 0-9 _ -'),
  description:                 z.string().max(255).default(''),
  discount_percent:            z.number().positive().max(100),
  max_uses:                    z.number().int().positive().nullable().default(null),
  min_amount_cents:            z.number().int().min(0).nullable().default(null),
  product_rule:                z.enum(['all', 'whitelist', 'blacklist']).default('all'),
  product_ids:                 z.array(z.string().max(64)).default([]),
  referrer_id:                 z.string().max(120).nullable().default(null),
  referrer_name:               z.string().max(120).nullable().default(null),
  referrer_commission_percent: z.number().positive().max(100).nullable().default(null),
  expires_at:                  z.string().datetime({ offset: true }).nullable().default(null),
  active:                      z.boolean().default(true),
});

const PatchCouponSchema = CouponSchema.partial().omit({ code: true });

// ─────────────────────────────────────────────────────────────────────────────
// Type
// ─────────────────────────────────────────────────────────────────────────────

interface CouponRow {
  id: number;
  code: string;
  description: string;
  discount_percent: string;
  max_uses: number | null;
  uses_count: number;
  min_amount_cents: number | null;
  product_rule: 'all' | 'whitelist' | 'blacklist';
  referrer_id: string | null;
  referrer_name: string | null;
  referrer_commission_percent: string | null;
  active: number;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const safePct = (v: string | null | number): number | null =>
  v === null ? null : parseFloat(String(v));

const formatCoupon = (row: CouponRow, productIds: string[]) => ({
  id:                          row.id,
  code:                        row.code,
  description:                 row.description,
  discount_percent:            safePct(row.discount_percent),
  max_uses:                    row.max_uses,
  uses_count:                  row.uses_count,
  min_amount_cents:            row.min_amount_cents,
  product_rule:                row.product_rule,
  product_ids:                 productIds,
  referrer_id:                 row.referrer_id,
  referrer_name:               row.referrer_name,
  referrer_commission_percent: safePct(row.referrer_commission_percent),
  active:                      Boolean(row.active),
  expires_at:                  row.expires_at,
  created_at:                  row.created_at,
  updated_at:                  row.updated_at,
});

const getCouponProductIds = async (couponId: number): Promise<string[]> => {
  const rows = await db.query<{ product_id: string }>(
    'SELECT product_id FROM coupon_products WHERE coupon_id = ?', [couponId]
  );
  return rows.map(r => r.product_id);
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/admin/coupons — list all with aggregate stats
// ─────────────────────────────────────────────────────────────────────────────

router.get('/', async (_req: Request, res: Response) => {
  const coupons = await db.query<CouponRow & {
    total_revenue_cents: number;
    total_discount_cents: number;
    total_commission_cents: number;
  }>(`
    SELECT
      c.*,
      COALESCE(SUM(cu.final_amount_cents), 0)    AS total_revenue_cents,
      COALESCE(SUM(cu.discount_amount_cents), 0) AS total_discount_cents,
      COALESCE(SUM(cu.commission_cents), 0)      AS total_commission_cents
    FROM coupons c
    LEFT JOIN coupon_usage cu ON cu.coupon_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `);

  const result = await Promise.all(coupons.map(async (row) => {
    const productIds = await getCouponProductIds(row.id);
    return {
      ...formatCoupon(row, productIds),
      stats: {
        total_revenue_cents:    Number(row.total_revenue_cents),
        total_discount_cents:   Number(row.total_discount_cents),
        total_commission_cents: Number(row.total_commission_cents),
      },
    };
  }));

  res.json({ coupons: result });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/admin/coupons — create
// ─────────────────────────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  let data: z.infer<typeof CouponSchema>;
  try { data = CouponSchema.parse(req.body); }
  catch (e) {
    if (e instanceof ZodError) { res.status(400).json({ error: 'validation', details: e.flatten() }); return; }
    throw e;
  }

  // Normalize code to uppercase
  data.code = data.code.toUpperCase();

  const existing = await db.query('SELECT id FROM coupons WHERE code = ?', [data.code]);
  if (existing.length > 0) { res.status(409).json({ error: 'code_already_exists' }); return; }

  // Validate referrer: commission requires referrer_id
  if (data.referrer_commission_percent && !data.referrer_id) {
    res.status(400).json({ error: 'referrer_id_required_with_commission' }); return;
  }

  const header = await db.execute(`
    INSERT INTO coupons
      (code, description, discount_percent, max_uses, min_amount_cents, product_rule,
       referrer_id, referrer_name, referrer_commission_percent, expires_at, active)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `, [
    data.code, data.description, data.discount_percent, data.max_uses,
    data.min_amount_cents, data.product_rule,
    data.referrer_id, data.referrer_name, data.referrer_commission_percent,
    data.expires_at, data.active ? 1 : 0,
  ]);

  const couponId = header.insertId;

  if (data.product_ids.length > 0) {
    for (const pid of data.product_ids) {
      await db.execute('INSERT IGNORE INTO coupon_products (coupon_id, product_id) VALUES (?,?)', [couponId, pid]);
    }
  }

  const [created] = await db.query<CouponRow>('SELECT * FROM coupons WHERE id = ?', [couponId]);
  const productIds = await getCouponProductIds(couponId);
  pushCatalogToFivem('coupon', 'created', data.code);
  res.status(201).json(formatCoupon(created, productIds));
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/admin/coupons/:code — single coupon detail
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:code', async (req: Request, res: Response) => {
  const code = req.params.code.toUpperCase();
  const [row] = await db.query<CouponRow>('SELECT * FROM coupons WHERE code = ?', [code]);
  if (!row) { res.status(404).json({ error: 'not_found' }); return; }
  const productIds = await getCouponProductIds(row.id);
  res.json(formatCoupon(row, productIds));
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /v1/admin/coupons/:code — full update
// ─────────────────────────────────────────────────────────────────────────────

router.put('/:code', async (req: Request, res: Response) => {
  const code = req.params.code.toUpperCase();
  const [existing] = await db.query<CouponRow>('SELECT * FROM coupons WHERE code = ?', [code]);
  if (!existing) { res.status(404).json({ error: 'not_found' }); return; }

  let data: Partial<z.infer<typeof CouponSchema>>;
  try { data = PatchCouponSchema.parse(req.body); }
  catch (e) {
    if (e instanceof ZodError) { res.status(400).json({ error: 'validation', details: e.flatten() }); return; }
    throw e;
  }

  const fields: string[] = [];
  const params: unknown[] = [];

  if (data.description         !== undefined) { fields.push('description = ?');                 params.push(data.description); }
  if (data.discount_percent    !== undefined) { fields.push('discount_percent = ?');            params.push(data.discount_percent); }
  if (data.max_uses            !== undefined) { fields.push('max_uses = ?');                    params.push(data.max_uses); }
  if (data.min_amount_cents    !== undefined) { fields.push('min_amount_cents = ?');            params.push(data.min_amount_cents); }
  if (data.product_rule        !== undefined) { fields.push('product_rule = ?');               params.push(data.product_rule); }
  if (data.referrer_id         !== undefined) { fields.push('referrer_id = ?');                params.push(data.referrer_id); }
  if (data.referrer_name       !== undefined) { fields.push('referrer_name = ?');              params.push(data.referrer_name); }
  if (data.referrer_commission_percent !== undefined) { fields.push('referrer_commission_percent = ?'); params.push(data.referrer_commission_percent); }
  if (data.expires_at          !== undefined) { fields.push('expires_at = ?');                 params.push(data.expires_at); }
  if (data.active              !== undefined) { fields.push('active = ?');                     params.push(data.active ? 1 : 0); }

  if (fields.length > 0) {
    params.push(code);
    await db.execute(`UPDATE coupons SET ${fields.join(', ')} WHERE code = ?`, params);
  }

  // Update product list if provided
  if (data.product_ids !== undefined) {
    await db.execute('DELETE FROM coupon_products WHERE coupon_id = ?', [existing.id]);
    for (const pid of data.product_ids) {
      await db.execute('INSERT IGNORE INTO coupon_products (coupon_id, product_id) VALUES (?,?)', [existing.id, pid]);
    }
  }

  const [updated] = await db.query<CouponRow>('SELECT * FROM coupons WHERE code = ?', [code]);
  const productIds = await getCouponProductIds(existing.id);
  pushCatalogToFivem('coupon', 'updated', code);
  res.json(formatCoupon(updated, productIds));
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /v1/admin/coupons/:code — soft delete (deactivate) or hard delete
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/:code', async (req: Request, res: Response) => {
  const code = req.params.code.toUpperCase();
  const hard = req.query.hard === 'true';

  if (hard) {
    await db.execute('DELETE FROM coupons WHERE code = ?', [code]);
  } else {
    const result = await db.execute('UPDATE coupons SET active = 0 WHERE code = ?', [code]);
    if ((result as any).affectedRows === 0) { res.status(404).json({ error: 'not_found' }); return; }
  }

  pushCatalogToFivem('coupon', 'deleted', code);
  res.json({ ok: true, deactivated: code });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/admin/coupons/:code/analytics — detailed analytics + usage history
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:code/analytics', async (req: Request, res: Response) => {
  const code = req.params.code.toUpperCase();
  const [coupon] = await db.query<CouponRow>('SELECT * FROM coupons WHERE code = ?', [code]);
  if (!coupon) { res.status(404).json({ error: 'not_found' }); return; }

  const [kpis] = await db.query<{
    uses: number; revenue: number; discount: number; commission: number;
  }>(`
    SELECT
      COUNT(*)                           AS uses,
      COALESCE(SUM(final_amount_cents), 0)    AS revenue,
      COALESCE(SUM(discount_amount_cents), 0) AS discount,
      COALESCE(SUM(commission_cents), 0)      AS commission
    FROM coupon_usage WHERE coupon_id = ?
  `, [coupon.id]);

  const history = await db.query(`
    SELECT
      cu.charge_id, cu.player_identifier, cu.product_id,
      cu.original_amount_cents, cu.discount_amount_cents,
      cu.final_amount_cents, cu.commission_cents, cu.created_at
    FROM coupon_usage cu
    WHERE cu.coupon_id = ?
    ORDER BY cu.created_at DESC
    LIMIT 200
  `, [coupon.id]);

  // Daily uses (last 30 days)
  const daily = await db.query(`
    SELECT DATE(created_at) AS day, COUNT(*) AS uses,
           SUM(final_amount_cents) AS revenue
    FROM coupon_usage
    WHERE coupon_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    GROUP BY day ORDER BY day ASC
  `, [coupon.id]);

  const productIds = await getCouponProductIds(coupon.id);

  res.json({
    coupon:  formatCoupon(coupon, productIds),
    kpis: {
      uses:             Number(kpis?.uses ?? 0),
      revenue_cents:    Number(kpis?.revenue ?? 0),
      discount_cents:   Number(kpis?.discount ?? 0),
      commission_cents: Number(kpis?.commission ?? 0),
    },
    daily,
    history,
  });
});

export const adminCouponsRouter = router;

// ─────────────────────────────────────────────────────────────────────────────
// Coupon validation helper (used by charge creation in index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface AppliedCoupon {
  couponId:            number;
  code:                string;
  discountPercent:     number;
  discountAmountCents: number;
  finalAmountCents:    number;
  commissionCents:     number | null;
  referrerId:          string | null;
  referrerName:        string | null;
}

export const validateAndApplyCoupon = async (
  code: string,
  amountCents: number,
  productId: string,
): Promise<{ ok: true; coupon: AppliedCoupon } | { ok: false; error: string }> => {
  const [row] = await db.query<CouponRow & { product_rule: string }>(
    'SELECT * FROM coupons WHERE code = ? AND active = 1', [code.toUpperCase()]
  );

  if (!row) return { ok: false, error: 'coupon_not_found' };

  // Expiry
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return { ok: false, error: 'coupon_expired' };
  }

  // Max uses
  if (row.max_uses !== null && row.uses_count >= row.max_uses) {
    return { ok: false, error: 'coupon_max_uses_reached' };
  }

  // Min amount
  if (row.min_amount_cents !== null && amountCents < row.min_amount_cents) {
    return { ok: false, error: 'coupon_min_amount_not_met' };
  }

  // Product rule
  if (row.product_rule !== 'all') {
    const productRows = await db.query<{ product_id: string }>(
      'SELECT product_id FROM coupon_products WHERE coupon_id = ?', [row.id]
    );
    const ids = productRows.map(r => r.product_id);
    if (row.product_rule === 'whitelist' && !ids.includes(productId)) {
      return { ok: false, error: 'coupon_product_not_allowed' };
    }
    if (row.product_rule === 'blacklist' && ids.includes(productId)) {
      return { ok: false, error: 'coupon_product_blocked' };
    }
  }

  const pct              = parseFloat(String(row.discount_percent));
  const discountCents    = Math.floor(amountCents * pct / 100);
  const finalCents       = Math.max(amountCents - discountCents, 1); // never < 1 cent

  const commissionPct    = row.referrer_commission_percent ? parseFloat(String(row.referrer_commission_percent)) : null;
  const commissionCents  = commissionPct !== null ? Math.floor(finalCents * commissionPct / 100) : null;

  return {
    ok: true,
    coupon: {
      couponId:            row.id,
      code:                row.code,
      discountPercent:     pct,
      discountAmountCents: discountCents,
      finalAmountCents:    finalCents,
      commissionCents,
      referrerId:          row.referrer_id,
      referrerName:        row.referrer_name,
    },
  };
};

export const recordCouponUsage = async (
  coupon: AppliedCoupon,
  chargeId: string,
  playerIdentifier: string,
  productId: string,
  originalAmountCents: number,
): Promise<void> => {
  await db.execute(`
    INSERT INTO coupon_usage
      (coupon_id, charge_id, player_identifier, product_id,
       original_amount_cents, discount_amount_cents, final_amount_cents, commission_cents)
    VALUES (?,?,?,?,?,?,?,?)
  `, [
    coupon.couponId, chargeId, playerIdentifier, productId,
    originalAmountCents, coupon.discountAmountCents, coupon.finalAmountCents, coupon.commissionCents,
  ]);
  await db.execute('UPDATE coupons SET uses_count = uses_count + 1 WHERE id = ?', [coupon.couponId]);
};
