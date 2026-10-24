import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from './db.js';
import { requireAdminSession } from './adminAuth.js';

export const adminPlayersRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/admin/players — lista paginada com analytics de compras
// ─────────────────────────────────────────────────────────────────────────────

adminPlayersRouter.get('/', requireAdminSession, async (req: Request, res: Response): Promise<void> => {
  const page  = Math.max(1, parseInt(String(req.query.page || '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10)));
  const offset = (page - 1) * limit;
  const search = req.query.search ? `%${String(req.query.search)}%` : null;

  const where  = search ? 'WHERE p.full_name LIKE ? OR p.email LIKE ? OR p.player_identifier LIKE ?' : '';
  const params = search ? [search, search, search] : [];

  const [rows, countRows] = await Promise.all([
    db.query<Record<string, unknown>>(`
      SELECT
        p.id,
        p.player_identifier,
        p.email,
        p.cpf,
        p.full_name,
        p.registered_at,
        p.updated_at,
        COUNT(c.id)                                           AS total_purchases,
        COALESCE(SUM(CASE WHEN c.status = 'PAID' THEN c.amount_cents ELSE 0 END), 0) AS total_spent_cents,
        COALESCE(SUM(CASE WHEN c.status = 'PAID' THEN 1 ELSE 0 END), 0)             AS paid_purchases
      FROM players p
      LEFT JOIN pix_charges c ON c.player_identifier = p.player_identifier
      ${where}
      GROUP BY p.id
      ORDER BY p.registered_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]),
    db.query<Record<string, unknown>>(`
      SELECT COUNT(DISTINCT p.id) AS total
      FROM players p
      ${where}
    `, params),
  ]);

  const total = Number((countRows[0] as Record<string, unknown>)?.total ?? 0);

  res.json({
    players: rows,
    meta: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/admin/players/kpis — métricas agregadas
// ─────────────────────────────────────────────────────────────────────────────

adminPlayersRouter.get('/kpis', requireAdminSession, async (_req: Request, res: Response): Promise<void> => {
  const [kpis] = await db.query<Record<string, unknown>>(`
    SELECT
      COUNT(DISTINCT p.id)                                                              AS total_players,
      COUNT(DISTINCT CASE WHEN c.status = 'PAID' THEN p.id END)                       AS players_with_purchase,
      COALESCE(SUM(CASE WHEN c.status = 'PAID' THEN c.amount_cents ELSE 0 END), 0)    AS total_revenue_cents,
      COALESCE(AVG(CASE WHEN c.status = 'PAID' THEN c.amount_cents END), 0)           AS avg_ticket_cents
    FROM players p
    LEFT JOIN pix_charges c ON c.player_identifier = p.player_identifier
  `);

  // Top comprador
  const [topBuyer] = await db.query<Record<string, unknown>>(`
    SELECT p.full_name, p.email, SUM(c.amount_cents) AS total_spent_cents, COUNT(*) AS purchases
    FROM players p
    INNER JOIN pix_charges c ON c.player_identifier = p.player_identifier AND c.status = 'PAID'
    GROUP BY p.id
    ORDER BY total_spent_cents DESC
    LIMIT 1
  `);

  res.json({ kpis, topBuyer: topBuyer ?? null });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/admin/players/:identifier — detalhe de um jogador
// ─────────────────────────────────────────────────────────────────────────────

adminPlayersRouter.get('/:identifier', requireAdminSession, async (req: Request, res: Response): Promise<void> => {
  const identifier = req.params.identifier;

  const [player] = await db.query<Record<string, unknown>>(
    'SELECT * FROM players WHERE player_identifier = ? LIMIT 1', [identifier]
  );
  if (!player) { res.status(404).json({ error: 'not_found' }); return; }

  const purchases = await db.query<Record<string, unknown>>(
    `SELECT internal_charge_id, product_id, amount_cents, status, created_at, updated_at
     FROM pix_charges WHERE player_identifier = ? ORDER BY created_at DESC LIMIT 50`,
    [identifier]
  );

  res.json({ player, purchases });
});

// ─────────────────────────────────────────────────────────────────────────────
// Service endpoints (chamados pelo servidor do jogo, não pelo admin panel)
// ─────────────────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  playerIdentifier: z.string().min(3).max(120).regex(/^[a-zA-Z0-9_:\-]+$/),
  email:            z.string().email().max(255),
  cpf:              z.string().min(11).max(20),
  fullName:         z.string().min(2).max(255),
});

/**
 * Upsert de jogador — cria se não existir, atualiza se existir.
 * Chamado pelo servidor do jogo com service auth.
 * Exportado para uso no index.ts.
 */
export const upsertPlayer = async (data: {
  playerIdentifier: string;
  email: string;
  cpf: string;
  fullName: string;
}): Promise<Record<string, unknown>> => {
  await db.execute(`
    INSERT INTO players (player_identifier, email, cpf, full_name)
    VALUES (?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      email      = VALUES(email),
      cpf        = VALUES(cpf),
      full_name  = VALUES(full_name),
      updated_at = NOW()
  `, [data.playerIdentifier, data.email, data.cpf, data.fullName]);

  const [row] = await db.query<Record<string, unknown>>(
    'SELECT * FROM players WHERE player_identifier = ? LIMIT 1',
    [data.playerIdentifier]
  );
  return row!;
};

/**
 * Busca dados de um jogador pelo identifier.
 * Exportado para uso no index.ts.
 */
export const findPlayer = async (playerIdentifier: string): Promise<Record<string, unknown> | null> => {
  const [row] = await db.query<Record<string, unknown>>(
    'SELECT * FROM players WHERE player_identifier = ? LIMIT 1',
    [playerIdentifier]
  );
  return row ?? null;
};

export { registerSchema };
