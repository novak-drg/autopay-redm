import { Router, Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { db } from './db.js';
import { config } from './config.js';
import { requireAdminSession } from './adminAuth.js';
import { pushCatalogToFivem } from './catalogPush.js';

// ─── Security constants ───────────────────────────────────────────────────────

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const SAFE_STRING = /^[^<>"'\\;]{1,255}$/;
const SAFE_PATH = /^[a-zA-Z0-9/_.\-:?=&%+@#]{0,512}$/;
const SAFE_IMAGE_URL = /^[a-zA-Z0-9/_.\-:?=&%+@#!~,;()\[\]]{0,512}$/;
const SAFE_PRICE_LABEL = /^[\w\s$.,R$/€£¥+-]{0,64}$/;

const ALLOWED_CURRENCIES = ['real_money', 'diamond', 'gold', 'dollar'] as const;
const ALLOWED_REWARD_TYPES = ['diamond', 'gold', 'rol', 'item', 'weapon', 'vip', 'custom'] as const;
const SLUG_PATTERN = /^[a-z0-9_-]{1,64}$/;

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const RewardEntrySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.enum(['diamond', 'gold', 'rol']),
    amount: z.number().int().positive().max(1_000_000),
  }),
  z.object({
    type: z.literal('item'),
    item: z.string().regex(ID_PATTERN, 'invalid item identifier'),
    amount: z.number().int().positive().max(9999).optional().default(1),
  }),
  z.object({
    type: z.literal('weapon'),
    weapon: z.string().regex(ID_PATTERN, 'invalid weapon identifier'),
    amount: z.number().int().positive().max(10).optional().default(1),
  }),
  z.object({
    type: z.literal('vip'),
    vip: z.string().regex(ID_PATTERN, 'invalid vip identifier'),
  }),
  z.object({
    type: z.literal('custom'),
    /** ID da recompensa customizada — o servidor Lua despacha pause:customReward com este ID */
    rewardId: z.string().regex(ID_PATTERN, 'invalid rewardId identifier'),
    /** Parâmetros adicionais enviados ao handler customizado (objeto chave-valor de strings) */
    params: z.record(z.string(), z.string().max(256)).optional().default({}),
  }),
]);

const ProductSchema = z.object({
  id: z.string().regex(ID_PATTERN, 'id must match ^[a-zA-Z0-9_-]{1,64}$'),
  label: z.string().min(1).max(255).regex(SAFE_STRING, 'label has invalid characters'),
  description: z.string().min(1).max(1000),
  currency: z.enum(ALLOWED_CURRENCIES),
  amountCents: z.number().int().nonnegative().max(99_999_99),
  displayPrice: z.string().max(64).regex(SAFE_PRICE_LABEL, 'displayPrice has invalid characters'),
  diamondCost: z.number().int().nonnegative().max(10_000_000).nullable().optional(),
  image: z.string().max(512).regex(SAFE_IMAGE_URL, 'image path has invalid characters').optional().default(''),
  category: z.string().regex(SLUG_PATTERN, 'category must match slug format'),
  bonus: z.number().int().nonnegative().max(10_000_000).nullable().optional(),
  sortOrder: z.number().int().nonnegative().max(999_999).optional().default(0),
  reward: z.array(RewardEntrySchema).min(1).max(20),
});

const PartialProductSchema = ProductSchema.omit({ id: true }).partial();

// ─── Auth middleware ──────────────────────────────────────────────────────────

// Accepts either x-admin-token (service-to-service) OR admin session JWT (browser panel)
const requireAdminAccess = (req: Request, res: Response, next: NextFunction): void => {
  const tokenHeader = req.header('x-admin-token') ?? '';
  if (config.adminToken && config.adminToken.length >= 32 && tokenHeader === config.adminToken) {
    return next();
  }
  // Fall back to session JWT (cookie-based auth for admin panel)
  requireAdminSession(req, res, next);
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseAndRespond = <T>(schema: z.ZodSchema<T>, data: unknown, res: Response): T | null => {
  const result = schema.safeParse(data);
  if (!result.success) {
    // DEBUG: log exact validation errors
    console.error('[validation_failed] body received:', JSON.stringify(data, null, 2));
    console.error('[validation_failed] errors:', JSON.stringify(result.error.flatten(), null, 2));
    res.status(422).json({ error: 'validation_failed', details: result.error.flatten() });
    return null;
  }
  return result.data;
};

const idParam = (req: Request, res: Response): string | null => {
  const { id } = req.params;
  if (!ID_PATTERN.test(id)) {
    res.status(400).json({ error: 'invalid_id' });
    return null;
  }
  return id;
};

// ─── Router ───────────────────────────────────────────────────────────────────

export const adminProductsRouter = Router();
adminProductsRouter.use(requireAdminAccess);

// GET /v1/admin/products
adminProductsRouter.get('/', async (_req: Request, res: Response) => {
  const rows = await db.query('SELECT * FROM products ORDER BY sort_order ASC, created_at ASC');
  res.json({ products: rows });
});

// GET /v1/admin/products/:id
adminProductsRouter.get('/:id', async (req: Request, res: Response) => {
  const id = idParam(req, res);
  if (!id) return;

  const [row] = await db.query('SELECT * FROM products WHERE id = ?', [id]);
  if (!row) { res.status(404).json({ error: 'product_not_found' }); return; }
  res.json({ product: row });
});

// POST /v1/admin/products  (create or full replace)
adminProductsRouter.post('/', async (req: Request, res: Response) => {
  const product = parseAndRespond(ProductSchema, req.body, res);
  if (!product) return;

  await db.execute(
    `INSERT INTO products
       (id, label, description, currency, amount_cents, display_price,
        diamond_cost, image, category, bonus, reward_json, sort_order, active)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)
     ON DUPLICATE KEY UPDATE
       label=VALUES(label), description=VALUES(description), currency=VALUES(currency),
       amount_cents=VALUES(amount_cents), display_price=VALUES(display_price),
       diamond_cost=VALUES(diamond_cost), image=VALUES(image), category=VALUES(category),
       bonus=VALUES(bonus), reward_json=VALUES(reward_json),
       sort_order=VALUES(sort_order), active=1`,
    [
      product.id, product.label, product.description, product.currency,
      product.amountCents, product.displayPrice, product.diamondCost ?? null,
      product.image, product.category, product.bonus ?? null,
      JSON.stringify(product.reward), product.sortOrder ?? 0,
    ]
  );

  pushCatalogToFivem('product', 'created', product.id);
  res.status(201).json({ ok: true, id: product.id });
});

// PUT /v1/admin/products/:id  (partial update)
adminProductsRouter.put('/:id', async (req: Request, res: Response) => {
  const id = idParam(req, res);
  if (!id) return;

  const patch = parseAndRespond(PartialProductSchema, req.body, res);
  if (!patch) return;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'no_fields_to_update' });
    return;
  }

  const [existing] = await db.query('SELECT id FROM products WHERE id = ?', [id]);
  if (!existing) { res.status(404).json({ error: 'product_not_found' }); return; }

  const colMap: Record<string, string> = {
    label: 'label',
    description: 'description',
    currency: 'currency',
    amountCents: 'amount_cents',
    displayPrice: 'display_price',
    diamondCost: 'diamond_cost',
    image: 'image',
    category: 'category',
    bonus: 'bonus',
    sortOrder: 'sort_order',
  };

  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [field, col] of Object.entries(colMap)) {
    if (field in patch) {
      setClauses.push(`${col} = ?`);
      values.push((patch as Record<string, unknown>)[field] ?? null);
    }
  }

  if ('reward' in patch && patch.reward) {
    setClauses.push('reward_json = ?');
    values.push(JSON.stringify(patch.reward));
  }

  values.push(id);
  await db.execute(`UPDATE products SET ${setClauses.join(', ')} WHERE id = ?`, values);

  pushCatalogToFivem('product', 'updated', id);
  res.json({ ok: true, id });
});

// DELETE /v1/admin/products/:id  (soft-delete or hard-delete)
adminProductsRouter.delete('/:id', async (req: Request, res: Response) => {
  const id = idParam(req, res);
  if (!id) return;

  const hard = req.query.hard === 'true';

  if (hard) {
    await db.execute('DELETE FROM products WHERE id = ?', [id]);
  } else {
    const result = await db.execute('UPDATE products SET active = 0 WHERE id = ?', [id]);
    if ((result as any).affectedRows === 0) {
      res.status(404).json({ error: 'product_not_found' });
      return;
    }
  }

  pushCatalogToFivem('product', 'deleted', id);
  res.json({ ok: true, id });
});
