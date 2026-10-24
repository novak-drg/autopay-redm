/**
 * src/adminBoxes.ts
 * CRUD de caixas (boxes) para o painel admin.
 * Suporta qualquer moeda: diamond, gold, real_money (PIX).
 * Inclui calculadora inteligente de percentual de drop.
 */

import { Router, Request, Response } from 'express';
import { z, ZodError } from 'zod';
import { db } from './db.js';
import { requireAdminSession } from './adminAuth.js';
import { config } from './config.js';
import { pushCatalogToFivem } from './catalogPush.js';

// ─── Patterns ────────────────────────────────────────────────────────────────

const ID_PATTERN  = /^[a-zA-Z0-9_-]{1,64}$/;
const SAFE_STRING = /^[^<>"'\\;]{1,255}$/;
const SAFE_PATH      = /^[a-zA-Z0-9/_.\\-]{0,512}$/;
const SAFE_IMAGE_URL = /^[a-zA-Z0-9/_.\-:?=&%+@#!~,;()[\]]{0,512}$/;
const ALLOWED_CURRENCIES = ['real_money', 'diamond', 'gold', 'dollar'] as const;
const ALLOWED_RARITIES   = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
const ALLOWED_REWARD_TYPES = ['diamond', 'gold', 'rol', 'item', 'weapon', 'vip'] as const;

// ─── Schemas ─────────────────────────────────────────────────────────────────

const RewardEntrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.enum(['diamond', 'gold', 'rol']), amount: z.number().int().positive().max(1_000_000) }),
  z.object({ type: z.literal('item'),   item:   z.string().regex(ID_PATTERN), amount: z.number().int().positive().max(9999).optional().default(1) }),
  z.object({ type: z.literal('weapon'), weapon: z.string().regex(ID_PATTERN), amount: z.number().int().positive().max(10).optional().default(1) }),
  z.object({ type: z.literal('vip'),    vip:    z.string().regex(ID_PATTERN) }),
]);

const BoxSchema = z.object({
  id:           z.string().regex(ID_PATTERN),
  name:         z.string().min(1).max(255).regex(SAFE_STRING),
  description:  z.string().max(1000).default(''),
  currency:     z.enum(ALLOWED_CURRENCIES),
  price:        z.number().int().nonnegative().max(99_999_99),
  displayPrice: z.string().max(64).default(''),
  color:        z.string().max(20).default('#4dd0e1'),
  image:        z.string().max(512).regex(SAFE_IMAGE_URL, 'image path has invalid characters').default(''),
  sortOrder:    z.number().int().nonnegative().max(999_999).default(0),
});

const BoxItemSchema = z.object({
  itemId:     z.string().regex(ID_PATTERN),
  itemName:   z.string().min(1).max(200).regex(SAFE_STRING),
  rarity:     z.enum(ALLOWED_RARITIES),
  image:      z.string().max(512).regex(SAFE_IMAGE_URL, 'image path has invalid characters').default(''),
  chancePct:  z.number().min(0).max(100),          // 0 = auto-distribuído
  locked:     z.boolean().default(false),           // se true, não redistribui
  reward:     RewardEntrySchema,
  sortOrder:  z.number().int().nonnegative().default(0),
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

const requireAdminAccess = (req: Request, res: Response, next: () => void): void => {
  const tokenHeader = req.header('x-admin-token') ?? '';
  if (config.adminToken && config.adminToken.length >= 32 && tokenHeader === config.adminToken) {
    return next();
  }
  requireAdminSession(req, res, next);
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface BoxItemRow {
  id:         number;
  box_id:     string;
  item_id:    string;
  item_name:  string;
  rarity:     string;
  image:      string;
  chance_pct: string | number;
  locked:     number;
  reward_json: string;
  sort_order: number;
}

const formatItem = (row: BoxItemRow) => ({
  id:        row.id,
  itemId:    row.item_id,
  itemName:  row.item_name,
  rarity:    row.rarity,
  image:     row.image,
  chancePct: parseFloat(String(row.chance_pct)),
  locked:    Boolean(row.locked),
  reward:    typeof row.reward_json === 'string' ? JSON.parse(row.reward_json) : row.reward_json,
  sortOrder: row.sort_order,
});

const getBoxItems = async (boxId: string) => {
  const rows = await db.query<BoxItemRow>(
    'SELECT * FROM box_items WHERE box_id = ? ORDER BY sort_order ASC, id ASC',
    [boxId],
  );
  return rows.map(formatItem);
};

/**
 * Calculadora inteligente de percentual.
 * Items com locked=true têm chance_pct fixo.
 * Os restantes dividem igualmente o percentual disponível.
 */
const recalcPercentages = async (boxId: string): Promise<void> => {
  const rows = await db.query<BoxItemRow & { is_locked: number }>(
    'SELECT id, chance_pct, locked FROM box_items WHERE box_id = ? ORDER BY id ASC',
    [boxId],
  );

  if (rows.length === 0) return;

  const locked   = rows.filter(r => r.locked);
  const unlocked = rows.filter(r => !r.locked);

  const lockedSum = locked.reduce((s, r) => s + parseFloat(String(r.chance_pct)), 0);
  const remainder = Math.max(0, 100 - lockedSum);

  if (unlocked.length > 0) {
    const share = +(remainder / unlocked.length).toFixed(3);
    // Distribui igualmente, última linha absorve arredondamento
    for (let i = 0; i < unlocked.length; i++) {
      const pct = i === unlocked.length - 1
        ? +(remainder - share * (unlocked.length - 1)).toFixed(3)
        : share;
      await db.execute('UPDATE box_items SET chance_pct = ? WHERE id = ?', [pct, unlocked[i].id]);
    }
  }
};

// ─── Router ──────────────────────────────────────────────────────────────────

export const adminBoxesRouter = Router();
adminBoxesRouter.use(requireAdminAccess as any);

// GET /v1/admin/boxes
adminBoxesRouter.get('/', async (_req: Request, res: Response) => {
  const rows = await db.query<Record<string, unknown>>(
    'SELECT * FROM boxes ORDER BY sort_order ASC, created_at ASC',
  );

  const boxes = await Promise.all(rows.map(async (box) => ({
    ...box,
    items: await getBoxItems(String(box.id)),
  })));

  res.json({ boxes });
});

// GET /v1/admin/boxes/:id
adminBoxesRouter.get('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!ID_PATTERN.test(id)) { res.status(400).json({ error: 'invalid_id' }); return; }

  const [box] = await db.query<Record<string, unknown>>('SELECT * FROM boxes WHERE id = ?', [id]);
  if (!box) { res.status(404).json({ error: 'box_not_found' }); return; }

  res.json({ box: { ...box, items: await getBoxItems(id) } });
});

// POST /v1/admin/boxes (create)
adminBoxesRouter.post('/', async (req: Request, res: Response) => {
  let data: z.infer<typeof BoxSchema>;
  try { data = BoxSchema.parse(req.body); }
  catch (e) {
    if (e instanceof ZodError) { res.status(400).json({ error: 'validation', details: e.flatten() }); return; }
    throw e;
  }

  await db.execute(
    `INSERT INTO boxes (id, name, description, currency, price, display_price, color, image, sort_order, active)
     VALUES (?,?,?,?,?,?,?,?,?,1)
     ON DUPLICATE KEY UPDATE
       name=VALUES(name), description=VALUES(description), currency=VALUES(currency),
       price=VALUES(price), display_price=VALUES(display_price), color=VALUES(color),
       image=VALUES(image), sort_order=VALUES(sort_order), active=1`,
    [data.id, data.name, data.description, data.currency, data.price,
     data.displayPrice, data.color, data.image, data.sortOrder],
  );

  pushCatalogToFivem('box', 'created', data.id);
  res.status(201).json({ ok: true, id: data.id });
});

// PUT /v1/admin/boxes/:id (update)
adminBoxesRouter.put('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!ID_PATTERN.test(id)) { res.status(400).json({ error: 'invalid_id' }); return; }

  const [existing] = await db.query('SELECT id FROM boxes WHERE id = ?', [id]);
  if (!existing) { res.status(404).json({ error: 'box_not_found' }); return; }

  let data: Partial<z.infer<typeof BoxSchema>>;
  try { data = BoxSchema.omit({ id: true }).partial().parse(req.body); }
  catch (e) {
    if (e instanceof ZodError) { res.status(400).json({ error: 'validation', details: e.flatten() }); return; }
    throw e;
  }

  const colMap: Record<string, string> = {
    name: 'name', description: 'description', currency: 'currency',
    price: 'price', displayPrice: 'display_price', color: 'color',
    image: 'image', sortOrder: 'sort_order',
  };

  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [field, col] of Object.entries(colMap)) {
    if (field in data) { sets.push(`${col} = ?`); vals.push((data as Record<string, unknown>)[field]); }
  }

  if (sets.length > 0) {
    vals.push(id);
    await db.execute(`UPDATE boxes SET ${sets.join(', ')} WHERE id = ?`, vals);
  }

  pushCatalogToFivem('box', 'updated', id);
  res.json({ ok: true, id, box: { ...existing, ...data, items: await getBoxItems(id) } });
});

// DELETE /v1/admin/boxes/:id (soft delete or hard delete)
adminBoxesRouter.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!ID_PATTERN.test(id)) { res.status(400).json({ error: 'invalid_id' }); return; }

  const hard = req.query.hard === 'true';

  if (hard) {
    await db.execute('DELETE FROM boxes WHERE id = ?', [id]);
  } else {
    const result = await db.execute('UPDATE boxes SET active = 0 WHERE id = ?', [id]);
    if ((result as any).affectedRows === 0) { res.status(404).json({ error: 'box_not_found' }); return; }
  }

  pushCatalogToFivem('box', 'deleted', id);
  res.json({ ok: true, id });
});

// ─── Items ────────────────────────────────────────────────────────────────────

// GET /v1/admin/boxes/:id/items
adminBoxesRouter.get('/:id/items', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!ID_PATTERN.test(id)) { res.status(400).json({ error: 'invalid_id' }); return; }
  res.json({ items: await getBoxItems(id), totalChance: 100 });
});

// POST /v1/admin/boxes/:id/items (add item + smart recalc)
adminBoxesRouter.post('/:id/items', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!ID_PATTERN.test(id)) { res.status(400).json({ error: 'invalid_id' }); return; }

  const [box] = await db.query('SELECT id FROM boxes WHERE id = ?', [id]);
  if (!box) { res.status(404).json({ error: 'box_not_found' }); return; }

  let data: z.infer<typeof BoxItemSchema>;
  try { data = BoxItemSchema.parse(req.body); }
  catch (e) {
    if (e instanceof ZodError) { res.status(400).json({ error: 'validation', details: e.flatten() }); return; }
    throw e;
  }

  // chancePct == 0 → auto (não bloqueado), > 0 → bloqueado automaticamente
  const locked   = data.locked || data.chancePct > 0;
  const chancePct = data.chancePct;

  await db.execute(
    `INSERT INTO box_items (box_id, item_id, item_name, rarity, image, chance_pct, locked, reward_json, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE
       item_name=VALUES(item_name), rarity=VALUES(rarity), image=VALUES(image),
       chance_pct=VALUES(chance_pct), locked=VALUES(locked),
       reward_json=VALUES(reward_json), sort_order=VALUES(sort_order)`,
    [id, data.itemId, data.itemName, data.rarity, data.image,
     chancePct, locked ? 1 : 0, JSON.stringify(data.reward), data.sortOrder],
  );

  // Recalcula percentuais dos itens não bloqueados
  await recalcPercentages(id);

  pushCatalogToFivem('box', 'updated', id);
  res.status(201).json({ ok: true, items: await getBoxItems(id) });
});

// PUT /v1/admin/boxes/:id/items/:itemId (update item + smart recalc)
adminBoxesRouter.put('/:id/items/:itemId', async (req: Request, res: Response) => {
  const { id, itemId } = req.params;
  if (!ID_PATTERN.test(id) || !ID_PATTERN.test(itemId)) {
    res.status(400).json({ error: 'invalid_id' }); return;
  }

  let data: Partial<z.infer<typeof BoxItemSchema>>;
  try { data = BoxItemSchema.partial().parse(req.body); }
  catch (e) {
    if (e instanceof ZodError) { res.status(400).json({ error: 'validation', details: e.flatten() }); return; }
    throw e;
  }

  const colMap: Record<string, string> = {
    itemName: 'item_name', rarity: 'rarity', image: 'image',
    chancePct: 'chance_pct', locked: 'locked', sortOrder: 'sort_order',
  };

  const sets: string[] = [];
  const vals: unknown[] = [];

  for (const [field, col] of Object.entries(colMap)) {
    if (field in data) {
      sets.push(`${col} = ?`);
      const raw = (data as Record<string, unknown>)[field];
      vals.push(col === 'locked' ? (raw ? 1 : 0) : raw);
    }
  }

  if ('reward' in data && data.reward) {
    sets.push('reward_json = ?');
    vals.push(JSON.stringify(data.reward));
  }

  // Se chancePct está sendo definido (> 0), auto-bloqueia
  if ('chancePct' in data && (data.chancePct ?? 0) > 0 && !('locked' in data)) {
    sets.push('locked = 1');
  }

  if (sets.length > 0) {
    vals.push(id, itemId);
    await db.execute(`UPDATE box_items SET ${sets.join(', ')} WHERE box_id = ? AND item_id = ?`, vals);
  }

  await recalcPercentages(id);
  pushCatalogToFivem('box', 'updated', id);
  res.json({ ok: true, items: await getBoxItems(id) });
});

// DELETE /v1/admin/boxes/:id/items/:itemId
adminBoxesRouter.delete('/:id/items/:itemId', async (req: Request, res: Response) => {
  const { id, itemId } = req.params;
  if (!ID_PATTERN.test(id) || !ID_PATTERN.test(itemId)) {
    res.status(400).json({ error: 'invalid_id' }); return;
  }

  await db.execute('DELETE FROM box_items WHERE box_id = ? AND item_id = ?', [id, itemId]);
  await recalcPercentages(id);
  pushCatalogToFivem('box', 'updated', id);
  res.json({ ok: true });
});
