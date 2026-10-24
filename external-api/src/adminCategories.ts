import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { requireAdminSession } from './adminAuth.js';

// ─── Validation ────────────────────────────────────────────────────────────────

const SLUG_PATTERN = /^[a-z0-9_-]{1,64}$/;
const SAFE_LABEL   = /^[^\u003c\u003e"'\\;]{1,128}$/;

const CategorySchema = z.object({
  slug:       z.string().regex(SLUG_PATTERN,   'slug must be lowercase letters, numbers, _ or -'),
  label:      z.string().min(1).max(128).regex(SAFE_LABEL, 'label has invalid characters'),
  sort_order: z.number().int().nonnegative().max(9999).optional().default(0),
});

const PatchCategorySchema = CategorySchema.omit({ slug: true }).partial();

// ─── Router ───────────────────────────────────────────────────────────────────

export const adminCategoriesRouter = Router();
adminCategoriesRouter.use(requireAdminSession);

// GET /v1/admin/categories
adminCategoriesRouter.get('/', async (_req: Request, res: Response) => {
  const data = await db.query(
    'SELECT id, slug, label, sort_order, active FROM product_categories ORDER BY sort_order ASC, label ASC'
  );
  res.json({ data });
});

// POST /v1/admin/categories
adminCategoriesRouter.post('/', async (req: Request, res: Response) => {
  const parsed = CategorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'validation_failed', details: parsed.error.flatten() });
    return;
  }
  const { slug, label, sort_order } = parsed.data;

  try {
    const result = await db.execute(
      'INSERT INTO product_categories (slug, label, sort_order) VALUES (?,?,?)',
      [slug, label, sort_order]
    );
    res.status(201).json({ ok: true, id: result.insertId });
  } catch (e: unknown) {
    const err = e as { code?: string };
    if (err.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'slug_already_exists' });
      return;
    }
    throw e;
  }
});

// PUT /v1/admin/categories/:id
adminCategoriesRouter.put('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid_id' }); return;
  }

  const parsed = PatchCategorySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'validation_failed', details: parsed.error.flatten() });
    return;
  }

  const patch = parsed.data;
  const setClauses: string[] = [];
  const values: unknown[]    = [];

  if (patch.label      !== undefined) { setClauses.push('label = ?');      values.push(patch.label); }
  if (patch.sort_order !== undefined) { setClauses.push('sort_order = ?'); values.push(patch.sort_order); }

  if (setClauses.length === 0) {
    res.status(400).json({ error: 'no_fields_to_update' }); return;
  }

  values.push(id);
  const result = await db.execute(
    `UPDATE product_categories SET ${setClauses.join(', ')} WHERE id = ?`,
    values
  );
  if (result.affectedRows === 0) {
    res.status(404).json({ error: 'category_not_found' }); return;
  }
  res.json({ ok: true });
});

// DELETE /v1/admin/categories/:id
adminCategoriesRouter.delete('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'invalid_id' }); return;
  }

  const hard = req.query.hard === 'true';

  if (hard) {
    await db.execute('DELETE FROM product_categories WHERE id = ?', [id]);
  } else {
    const result = await db.execute(
      'UPDATE product_categories SET active = 0 WHERE id = ?', [id]
    );
    if ((result as any).affectedRows === 0) {
      res.status(404).json({ error: 'category_not_found' }); return;
    }
  }

  res.json({ ok: true });
});
