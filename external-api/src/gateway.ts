import crypto from 'crypto';
import { config } from './config.js';
import { ChargeStatus, CreateChargeInput, GatewayCreateChargeResult, GatewayStatusResult, GatewayWebhookPayload } from './types.js';

const MP_API = 'https://api.mercadopago.com';

// ─────────────────────────────────────────────────────────────────────────────
// Status normalization
// ─────────────────────────────────────────────────────────────────────────────

const normalizeStatus = (value: unknown): ChargeStatus => {
  const s = String(value || '').toLowerCase().trim();
  if (s === 'approved')                        return 'PAID';
  if (s === 'pending' || s === 'in_process')   return 'PENDING';
  if (s === 'cancelled' || s === 'canceled')   return 'CANCELED';
  if (s === 'refunded')                        return 'REFUNDED';
  if (s === 'charged_back')                    return 'CHARGEDBACK';
  return 'FAILED';
};

// ─────────────────────────────────────────────────────────────────────────────
// Mercado Pago HTTP helper
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const isTransientError = (status: number, body: string): boolean =>
  status >= 500 && (
    body.includes('http is unavailable') ||
    body.includes('internal_server_error') ||
    body.includes('service_unavailable') ||
    status === 503 || status === 502
  );

const mpFetch = async (
  method: string,
  path: string,
  opts: { body?: unknown; idempotencyKey?: string } = {},
  attempt = 1,
): Promise<Record<string, unknown>> => {
  const MAX_ATTEMPTS = 3;
  const url = `${MP_API}${path}`;
  const headers: Record<string, string> = {
    Authorization:  `Bearer ${config.mercadoPagoAccessToken}`,
    'Content-Type': 'application/json',
  };
  if (opts.idempotencyKey) headers['X-Idempotency-Key'] = opts.idempotencyKey;

  console.log(`[mp] ► ${method} ${path}${attempt > 1 ? ` (tentativa ${attempt}/${MAX_ATTEMPTS})` : ''}`);

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  const raw = await res.text();
  console.log(`[mp] ${method} response ${res.status}`);

  if (!res.ok) {
    if (isTransientError(res.status, raw) && attempt < MAX_ATTEMPTS) {
      await sleep(attempt * 2000);
      return mpFetch(method, path, opts, attempt + 1);
    }
    throw new Error(`mp_api_failed:${res.status}`);
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('mp_invalid_json');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Create charge
// ─────────────────────────────────────────────────────────────────────────────

export const createCharge = async (
  input: CreateChargeInput & { payerEmail?: string },
): Promise<GatewayCreateChargeResult> => {
  const amountBrl  = input.amountCents / 100;
  const payerEmail = input.payerEmail || config.mercadoPagoPayerEmail;
  if (!payerEmail) throw new Error('payer_email_required');

  const body = {
    transaction_amount:  amountBrl,
    description:         `Pagamento ${input.productId} — AutoPay RedM`,
    payment_method_id:   'pix',
    external_reference:  input.internalChargeId,
    date_of_expiration:  new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
    payer:               { email: payerEmail },
    notification_url:    config.mercadoPagoNotificationUrl || undefined,
    metadata: {
      internal_charge_id: input.internalChargeId,
      player_identifier:  input.playerIdentifier,
      product_id:         input.productId,
    },
  };

  const data     = await mpFetch('POST', '/v1/payments', { body, idempotencyKey: input.idempotencyKey });
  const mpId     = String(data.id ?? '');
  if (!mpId) throw new Error('mp_missing_payment_id');

  const status   = normalizeStatus(data.status);
  const txData   = (data.point_of_interaction as Record<string, unknown> | undefined)?.transaction_data as Record<string, unknown> | undefined;
  const qrText   = String(txData?.qr_code        ?? '');
  const qrBase64 = String(txData?.qr_code_base64  ?? '');
  const expiresAt = data.date_of_expiration
    ? new Date(String(data.date_of_expiration))
    : new Date(Date.now() + input.expiresInSeconds * 1000);

  return { gatewayName: 'mercadopago', gatewayChargeId: mpId, externalReference: input.internalChargeId, qrCodeBase64: qrBase64, qrCodeText: qrText, status, expiresAt };
};

// ─────────────────────────────────────────────────────────────────────────────
// Status check (used internally for pending reuse validation)
// ─────────────────────────────────────────────────────────────────────────────

export const getChargeStatus = async (_gatewayName: string, gatewayChargeId: string): Promise<GatewayStatusResult> => {
  const data    = await mpFetch('GET', `/v1/payments/${gatewayChargeId}`);
  const status  = normalizeStatus(data.status);
  const txData  = (data.point_of_interaction as Record<string, unknown> | undefined)?.transaction_data as Record<string, unknown> | undefined;
  return {
    status,
    transactionId: String(data.id ?? ''),
    endToEndId:    String((data as Record<string, unknown>).transaction_id ?? txData?.transaction_id ?? ''),
    qrCodeText:    String(txData?.qr_code        ?? ''),
    qrCodeBase64:  String(txData?.qr_code_base64  ?? ''),
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Webhook parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processa webhook do Mercado Pago: { type: 'payment', data: { id: '123' } }
 * Consulta GET /v1/payments/{id} para verificar o status real (não confia no corpo do webhook).
 */
export const parseMercadoPagoWebhook = async (
  body: Record<string, unknown>,
): Promise<GatewayWebhookPayload | null> => {
  if (body.type !== 'payment') {
    console.log(`[mp][webhook] Ignorando evento tipo: ${String(body.type)}`);
    return null;
  }

  const mpId = String((body.data as Record<string, unknown> | undefined)?.id ?? '');
  if (!/^\d{1,32}$/.test(mpId)) return null;

  const data        = await mpFetch('GET', `/v1/payments/${mpId}`);
  const status      = normalizeStatus(data.status);
  const externalRef = String(data.external_reference ?? '');
  const txData      = (data.point_of_interaction as Record<string, unknown> | undefined)?.transaction_data as Record<string, unknown> | undefined;

  return {
    gatewayChargeId:   mpId,
    amountCents: Math.round(Number(data.transaction_amount) * 100),
    currency: String(data.currency_id ?? ''),
    externalReference: externalRef,
    status,
    transactionId: String(data.id ?? ''),
    endToEndId:    String((data as Record<string, unknown>).transaction_id ?? txData?.transaction_id ?? ''),
    isRefund:      status === 'REFUNDED' || status === 'CHARGEDBACK',
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Cancel charge (best-effort, called when a stale pending charge is replaced)
// ─────────────────────────────────────────────────────────────────────────────

export const cancelCharge = async (_gatewayName: string, gatewayChargeId: string): Promise<boolean> => {
  try {
    await mpFetch('PUT', `/v1/payments/${gatewayChargeId}`, { body: { status: 'cancelled' } });
    console.log(`[mp] ✅ Pagamento ${gatewayChargeId} cancelado.`);
    return true;
  } catch (err) {
    console.warn(`[mp] ⚠ Não foi possível cancelar ${gatewayChargeId}:`, err);
    return false;
  }
};
