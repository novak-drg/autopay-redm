import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { z } from 'zod';
import { config } from './config.js';
import { requireServiceAuth } from './auth.js';
import { createCharge, getChargeStatus, cancelCharge, parseMercadoPagoWebhook } from './gateway.js';
import { repository } from './repository.js';
import { ensureTables, pool, db } from './db.js';
import { blocklistCheck, honeypotRouter } from './middleware/honeypot.js';
import { webhookIpAllowlist } from './middleware/ipAllowlist.js';
import { requireSignature } from './middleware/signature.js';
import { createPaymentWebhook } from './paymentWebhook.js';
import { startDeliveryWorker } from './outboxStore.js';
import { adminProductsRouter } from './adminProducts.js';
import { adminAuthRouter } from './adminAuth.js';
import { adminAnalyticsRouter } from './adminAnalytics.js';
import { adminCategoriesRouter } from './adminCategories.js';
import { adminCouponsRouter, validateAndApplyCoupon, recordCouponUsage } from './adminCoupons.js';
import { adminPlayersRouter, upsertPlayer, findPlayer, registerSchema } from './adminPlayers.js';
import { adminBoxesRouter } from './adminBoxes.js';

// ─────────────────────────────────────────────────────────────────────────────
// Crash protection — erros não derrubam o processo
// ─────────────────────────────────────────────────────────────────────────────


const asyncRoute =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch((err: unknown) => next(err));
  };

// ─────────────────────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

// Configure 'loopback', ou uma string com o IP do Load Balancer (Ex: '127.0.0.1', '10.0.0.2', 'cloudflare')
// Evita "trust proxy 1" irrestrito para prevenir fraude do IP Real nos limites HTTP via Rate Limiter
app.set('trust proxy', 'loopback');
app.use(helmet());
app.use(cookieParser());
app.use(express.json({ limit: '256kb', verify: (req, _res, buffer) => {
  (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
} }));
app.use((req, res, next) => {
  if (!req.path.startsWith('/v1/') || req.path.startsWith('/v1/admin/') || req.path.startsWith('/v1/webhooks/')) { next(); return; }
  requireServiceAuth(req, res, () => { void requireSignature(req, res, next); });
});
app.use(blocklistCheck);
app.use(honeypotRouter);

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiters
// ─────────────────────────────────────────────────────────────────────────────

const chargeCreateLimit = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'rate_limited' } });
const statusLimit       = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'rate_limited' } });
const webhookLimit      = rateLimit({ windowMs: 10_000, max: 50, standardHeaders: true, legacyHeaders: false, message: { error: 'rate_limited' } });
const adminLimit        = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'rate_limited' } });

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const createChargeSchema = z.object({
  internalChargeId: z.string().min(4).max(64).regex(/^[a-zA-Z0-9_\-]+$/),
  idempotencyKey:   z.string().min(6).max(150),
  amountCents:      z.number().int().positive().max(100_000_00),
  currency:         z.literal('BRL'),
  playerIdentifier: z.string().min(3).max(120).regex(/^[a-zA-Z0-9_:\-]+$/),
  productId:        z.string().min(2).max(64).regex(/^[a-zA-Z0-9_\-]+$/),
  expiresInSeconds: z.number().int().min(60).max(3600),
  couponCode:       z.string().min(2).max(50).regex(/^[A-Za-z0-9_-]+$/).optional(),
  metadata:         z.record(z.string(), z.unknown()).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true, service: 'pause-pix-api' }));

// ─────────────────────────────────────────────────────────────────────────────
// Admin routes
// ─────────────────────────────────────────────────────────────────────────────

app.use('/v1/admin/auth',                   express.json({ limit: '16kb' }), adminAuthRouter);
app.use('/v1/admin/analytics',              adminAnalyticsRouter);
app.use('/v1/admin/analytics/transactions', adminAnalyticsRouter);
app.use('/v1/admin/products',               adminLimit, express.json({ limit: '64kb' }), adminProductsRouter);
app.use('/v1/admin/categories',             adminLimit, express.json({ limit: '16kb' }), adminCategoriesRouter);
app.use('/v1/admin/coupons',               adminLimit, express.json({ limit: '32kb' }), adminCouponsRouter);
app.use('/v1/admin/players',               adminLimit, express.json({ limit: '16kb' }), adminPlayersRouter);
app.use('/v1/admin/boxes',                 adminLimit, express.json({ limit: '64kb' }), adminBoxesRouter);

// ─────────────────────────────────────────────────────────────────────────────
// Service: Players
// ─────────────────────────────────────────────────────────────────────────────

app.post(
  '/v1/players/register',
  requireServiceAuth,
  express.json({ limit: '8kb' }),
  asyncRoute(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() }); return; }
    const player = await upsertPlayer(parsed.data);
    res.json({ ok: true, player });
  }),
);

app.get(
  '/v1/players/:identifier',
  requireServiceAuth,
  asyncRoute(async (req, res) => {
    const player = await findPlayer(req.params.identifier);
    if (!player) { res.status(404).json({ registered: false }); return; }
    res.json({ registered: true, player });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Service: Product catalog
// ─────────────────────────────────────────────────────────────────────────────

app.get(
  '/v1/service/products',
  requireServiceAuth,
  asyncRoute(async (_req, res) => {
    const rows = await db.query<Record<string, unknown>>('SELECT * FROM products WHERE active = 1 ORDER BY sort_order ASC');

    // Anexa os rewards mapeados para facilitar o uso no script Lua/FiveM
    const items = rows.map(r => ({
      ...r,
      rewards: typeof r.reward_json === 'string' ? JSON.parse(r.reward_json) : (r.reward_json || [])
    }));

    res.json({ products: items });
  }),
);

app.get(
  '/v1/service/products/:id/rewards',
  requireServiceAuth,
  asyncRoute(async (req, res) => {
    const rows = await db.query<Record<string, unknown>>(
      'SELECT reward_json FROM products WHERE id = ? AND active = 1',
      [req.params.id]
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'product_not_found' });
      return;
    }
    const raw = rows[0].reward_json;
    const rewards = typeof raw === 'string' ? JSON.parse(raw) : (raw || []);
    res.json({ rewards });
  }),
);

app.get(
  '/v1/service/boxes',
  requireServiceAuth,
  asyncRoute(async (_req, res) => {
    const boxes = await db.query<Record<string, unknown>>(
      'SELECT * FROM boxes WHERE active = 1 ORDER BY sort_order ASC',
    );
    const result = await Promise.all(boxes.map(async (box) => {
      const items = await db.query<Record<string, unknown>>(
        'SELECT item_id, item_name, rarity, image, chance_pct, locked, reward_json, sort_order FROM box_items WHERE box_id = ? ORDER BY sort_order ASC, id ASC',
        [box.id],
      );
      return {
        id:          box.id,
        name:        box.name,
        description: box.description,
        currency:    box.currency,
        price:       box.price,
        displayPrice: box.display_price,
        color:       box.color,
        image:       box.image,
        sortOrder:   box.sort_order,
        items: items.map(it => ({
          itemId:    it.item_id,
          itemName:  it.item_name,
          rarity:    it.rarity,
          image:     it.image,
          chancePct: parseFloat(String(it.chance_pct)),
          locked:    Boolean(it.locked),
          reward:    typeof it.reward_json === 'string' ? JSON.parse(it.reward_json as string) : (it.reward_json || []),
          sortOrder: it.sort_order,
        })),
      };
    }));
    res.json({ boxes: result });
  }),
);

app.get(
  '/v1/service/boxes/:id/items',
  requireServiceAuth,
  asyncRoute(async (req, res) => {
    const boxId = req.params.id;

    // Verifica se a caixa existe e tá ativa
    const activeBox = await db.query<Record<string, unknown>>(
      'SELECT id FROM boxes WHERE id = ? AND active = 1',
      [boxId]
    );
    if (!activeBox[0]) {
      res.status(404).json({ error: 'box_not_found' });
      return;
    }

    const items = await db.query<Record<string, unknown>>(
      'SELECT item_id, item_name, rarity, image, chance_pct, locked, reward_json, sort_order FROM box_items WHERE box_id = ? ORDER BY sort_order ASC, id ASC',
      [boxId],
    );

    const mappedItems = items.map(it => ({
      itemId:    it.item_id,
      itemName:  it.item_name,
      rarity:    it.rarity,
      image:     it.image,
      chancePct: parseFloat(String(it.chance_pct)),
      locked:    Boolean(it.locked),
      reward:    typeof it.reward_json === 'string' ? JSON.parse(it.reward_json as string) : (it.reward_json || []),
      sortOrder: it.sort_order,
    }));

    res.json({ items: mappedItems });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Service: Coupon validation (sem consumir uso — apenas valida)
// ─────────────────────────────────────────────────────────────────────────────

app.post(
  '/v1/coupons/validate',
  statusLimit,
  requireServiceAuth,
  express.json({ limit: '8kb' }),
  asyncRoute(async (req, res) => {
    const { code, productId, amountCents } = req.body as Record<string, unknown>;
    if (!code || !productId || typeof amountCents !== 'number') {
      res.status(400).json({ ok: false, error: 'invalid_payload' });
      return;
    }
    const result = await validateAndApplyCoupon(String(code), amountCents, String(productId));
    if (!result.ok) {
      res.json({ ok: false, error: result.error });
      return;
    }
    const { coupon } = result;
    res.json({
      ok:                  true,
      code:                coupon.code,
      discountPercent:     coupon.discountPercent,
      discountAmountCents: coupon.discountAmountCents,
      originalAmountCents: amountCents,
      finalAmountCents:    coupon.finalAmountCents,
      referrerName:        coupon.referrerName,
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Service: PIX Charges
// ─────────────────────────────────────────────────────────────────────────────

app.post(
  '/v1/payments/pix/charges',
  chargeCreateLimit,
  requireServiceAuth,
  express.json({ limit: '256kb' }),
  asyncRoute(async (req, res) => {
    const parsed = createChargeSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: 'invalid_payload', details: parsed.error.flatten() }); return; }

    const [catalogProduct] = await db.query<{ amount_cents: number }>(
      "SELECT amount_cents FROM products WHERE id = ? AND active = 1 AND currency = 'real_money'", [parsed.data.productId]);
    if (!catalogProduct || Number(catalogProduct.amount_cents) !== parsed.data.amountCents) {
      res.status(400).json({ error: 'catalog_price_mismatch' }); return;
    }

    // Idempotency: retorna cobrança existente se já foi criada com esta chave
    const existing = await repository.findByIdempotency(parsed.data.idempotencyKey);
    if (existing) {
      if (existing.playerIdentifier !== parsed.data.playerIdentifier || existing.productId !== parsed.data.productId
        || existing.internalChargeId !== parsed.data.internalChargeId) {
        res.status(409).json({ error: 'idempotency_conflict' }); return;
      }
      res.json({
        externalReference: existing.externalReference,
        gatewayName:       existing.gatewayName,
        gatewayChargeId:   existing.gatewayChargeId,
        qrCodeBase64:      existing.qrCodeBase64,
        qrCodeText:        existing.qrCodeText,
        status:            existing.status,
        expiresAtEpoch:    Math.floor(existing.expiresAt.getTime() / 1000),
      });
      return;
    }

    // Evita duplicatas: reutiliza cobrança PENDING do mesmo player+produto se ainda válida
    const pendingRows = await db.query<Record<string, unknown>>(
      `SELECT * FROM pix_charges WHERE player_identifier = ? AND product_id = ? AND status IN ('PENDING','CREATED') ORDER BY created_at DESC LIMIT 1`,
      [parsed.data.playerIdentifier, parsed.data.productId],
    );

    if (pendingRows[0]) {
      const pending         = pendingRows[0];
      const gatewayChargeId = String(pending.gateway_charge_id);
      const gatewayName     = String(pending.gateway_name);
      const expiresAt       = new Date(String(pending.expires_at));

      let liveStatus = 'FAILED';
      try { liveStatus = (await getChargeStatus(gatewayName, gatewayChargeId)).status; } catch { liveStatus = 'FAILED'; }

      if ((liveStatus === 'PENDING' || liveStatus === 'CREATED') && expiresAt > new Date()) {
        console.log(`[pix] Reutilizando cobrança pendente ${gatewayChargeId} para ${parsed.data.playerIdentifier}`);
        res.json({
          // ← internalChargeId do banco: o Lua deve usar ESTE ID, não o que gerou localmente
          internalChargeId:  String(pending.internal_charge_id),
          externalReference: String(pending.external_reference),
          gatewayName, gatewayChargeId,
          qrCodeBase64:   String(pending.qr_code_base64),
          qrCodeText:     String(pending.qr_code_text),
          status:         String(pending.status),
          expiresAtEpoch: Math.floor(expiresAt.getTime() / 1000),
          reused:         true,
        });
        return;
      }

      // Expirada/cancelada: cancela no MP (best-effort) e marca no BD
      await cancelCharge(gatewayName, gatewayChargeId).catch(() => {});
      await db.execute(`UPDATE pix_charges SET status = 'EXPIRED', updated_at = NOW() WHERE gateway_charge_id = ?`, [gatewayChargeId]);
    }

    // Busca email real do jogador
    const playerRecord = await findPlayer(parsed.data.playerIdentifier);
    const payerEmail   = playerRecord ? String(playerRecord.email) : undefined;

    // Validação de cupom
    let appliedCoupon = null;
    let chargeAmount  = parsed.data.amountCents;
    if (parsed.data.couponCode) {
      const couponResult = await validateAndApplyCoupon(parsed.data.couponCode, parsed.data.amountCents, parsed.data.productId);
      if (!couponResult.ok) { res.status(400).json({ error: couponResult.error }); return; }
      appliedCoupon = couponResult.coupon;
      chargeAmount  = couponResult.coupon.finalAmountCents;
    }

    const gatewayResult = await createCharge({ ...parsed.data, amountCents: chargeAmount, payerEmail });
    const created       = await repository.createCharge({ ...parsed.data, amountCents: chargeAmount }, gatewayResult);

    if (appliedCoupon) {
      await recordCouponUsage(appliedCoupon, parsed.data.internalChargeId, parsed.data.playerIdentifier, parsed.data.productId, parsed.data.amountCents)
        .catch(err => console.warn('[coupon] recordCouponUsage falhou:', err));
    }

    res.status(201).json({
      externalReference: created.externalReference,
      gatewayName:       created.gatewayName,
      gatewayChargeId:   created.gatewayChargeId,
      qrCodeBase64:      created.qrCodeBase64,
      qrCodeText:        created.qrCodeText,
      status:            created.status,
      expiresAtEpoch:    Math.floor(created.expiresAt.getTime() / 1000),
      coupon: appliedCoupon ? {
        code:                appliedCoupon.code,
        discountPercent:     appliedCoupon.discountPercent,
        discountAmountCents: appliedCoupon.discountAmountCents,
        originalAmountCents: parsed.data.amountCents,
        finalAmountCents:    appliedCoupon.finalAmountCents,
        referrerName:        appliedCoupon.referrerName,
        commissionCents:     appliedCoupon.commissionCents,
      } : null,
    });
  }),
);

/** Retorna status da cobrança do banco (sem chamar o MP) */
app.get(
  '/v1/payments/pix/charges/:internalChargeId',
  statusLimit,
  requireServiceAuth,
  asyncRoute(async (req, res) => {
    const charge = await repository.findByInternalId(req.params.internalChargeId);
    if (!charge) { res.status(404).json({ error: 'not_found' }); return; }
    res.json({
      status:        charge.status,
      transactionId: charge.transactionId,
      endToEndId:    charge.endToEndId,
      qrCodeBase64:  charge.qrCodeBase64,
      qrCodeText:    charge.qrCodeText,
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// Service: Offline Delivery Sweep (Pull-based Fallback)
// ─────────────────────────────────────────────────────────────────────────────

app.get(
  '/v1/players/:identifier/pending-deliveries',
  statusLimit,
  requireServiceAuth,
  asyncRoute(async (req, res) => {
    const pending = await repository.getPendingDeliveries(req.params.identifier);
    res.json({
      ok: true,
      deliveries: pending.map(it => ({
        internalChargeId: it.internalChargeId,
        productId:        it.productId,
        amountCents:      it.amountCents,
        status:           it.status,
        metadata:         it.metadataJson,
        createdAtEpoch:   Math.floor(it.createdAt.getTime() / 1000),
      })),
    });
  }),
);

app.post(
  '/v1/payments/pix/charges/:internalChargeId/deliver',
  statusLimit,
  requireServiceAuth,
  asyncRoute(async (req, res) => {
    const success = await repository.markAsDelivered(req.params.internalChargeId);
    if (!success) {
      res.status(404).json({ ok: false, error: 'not_found_or_already_delivered' });
      return;
    }
    res.json({ ok: true });
  }),
);


// ─────────────────────────────────────────────────────────────────────────────
// Webhook: Mercado Pago → push para o servidor FiveM
// ─────────────────────────────────────────────────────────────────────────────

app.post('/v1/webhooks/pix', webhookLimit, webhookIpAllowlist,
  createPaymentWebhook({
    secret: config.mercadoPagoWebhookSecret,
    fetchPayment: parseMercadoPagoWebhook,
    persistPayment: payment => repository.atomicWebhookUpdate({
      externalReference: payment.externalReference, newStatus: payment.status,
      transactionId: payment.transactionId, endToEndId: payment.endToEndId,
      gatewayChargeId: payment.gatewayChargeId, amountCents: payment.amountCents,
      currency: payment.currency,
    }),
  }),
);

// // 404 + Error handler
// ─────────────────────────────────────────────────────────────────────────────

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const badJson = err instanceof SyntaxError;
  console.error('[API_ERROR]', badJson ? 'Invalid JSON' : 'Request failed');
  if (!res.headersSent) res.status(badJson ? 400 : 500).json({ error: badJson ? 'invalid_json' : 'internal_server_error' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

const ensureTablesWithRetry = async (maxAttempts = 10, delayMs = 3000): Promise<void> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await ensureTables();
      console.log('[pause-pix-api] DB tables OK.');
      return;
    } catch (err) {
      console.error(`[pause-pix-api] DB falhou (tentativa ${attempt}/${maxAttempts}):`, err);
      if (attempt === maxAttempts) throw new Error('DB indisponível — abortando.');
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
};

const bootstrap = async (): Promise<void> => {
  await ensureTablesWithRetry();
  const stopDeliveryWorker = startDeliveryWorker();

  const server = app.listen(config.port, config.bindHost, () => {
    const mode = config.mercadoPagoAccessToken.startsWith('TEST-') ? '🟡 SANDBOX' : '🟢 PRODUÇÃO';
    console.log(`[pause-pix-api] Escutando na porta ${config.port} — Mercado Pago ${mode}`);
    console.log(`[mp] Notif URL: ${config.mercadoPagoNotificationUrl || '(não configurada — configure no painel MP)'}`);
    console.log(`[fivem] Callback: ${config.fivemCallbackUrl}`);
  });

  server.on('error', err => console.error('[pause-pix-api] Erro HTTP:', err));

  const shutdown = (signal: string) => {
    console.log(`[pause-pix-api] ${signal} — graceful shutdown...`);
    stopDeliveryWorker();
    server.close(() => { void pool.end().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
};

bootstrap().catch(err => {
  console.error('[pause-pix-api] Falha fatal no bootstrap:', err);
  process.exit(1);
});
