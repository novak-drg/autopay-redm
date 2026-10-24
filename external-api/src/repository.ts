import { ResultSetHeader } from 'mysql2';
import { db, pool } from './db.js';
import type { RowDataPacket } from 'mysql2';
import { canTransition, needsGameNotification } from './paymentPolicy.js';
import { gamePayload } from './deliveryOutbox.js';
import { AtomicUpdateResult, ChargeRecord, ChargeStatus, CreateChargeInput, GatewayCreateChargeResult } from './types.js';

const mapRow = (row: Record<string, unknown>): ChargeRecord => ({
  internalChargeId: String(row.internal_charge_id),
  idempotencyKey: String(row.idempotency_key),
  playerIdentifier: String(row.player_identifier),
  productId: String(row.product_id),
  amountCents: Number(row.amount_cents),
  currency: 'BRL',
  status: String(row.status) as ChargeStatus,
  externalReference: String(row.external_reference),
  gatewayName: String(row.gateway_name),
  gatewayChargeId: String(row.gateway_charge_id),
  qrCodeBase64: String(row.qr_code_base64),
  qrCodeText: String(row.qr_code_text),
  transactionId: row.transaction_id ? String(row.transaction_id) : null,
  endToEndId: row.end_to_end_id ? String(row.end_to_end_id) : null,
  expiresAt: new Date(String(row.expires_at)),
  createdAt: new Date(String(row.created_at)),
  updatedAt: new Date(String(row.updated_at)),
  metadataJson:
    typeof row.metadata_json === 'string'
      ? (JSON.parse(String(row.metadata_json)) as Record<string, unknown>)
      : ((row.metadata_json as Record<string, unknown>) || {}),
  deliveredAt: row.delivered_at ? new Date(String(row.delivered_at)) : null,
});

export const repository = {
  async findByInternalId(internalChargeId: string): Promise<ChargeRecord | null> {
    const result = await db.query('SELECT * FROM pix_charges WHERE internal_charge_id = ? LIMIT 1', [internalChargeId]);
    if (!result[0]) return null;
    return mapRow(result[0] as Record<string, unknown>);
  },

  async findByIdempotency(idempotencyKey: string): Promise<ChargeRecord | null> {
    const result = await db.query('SELECT * FROM pix_charges WHERE idempotency_key = ? LIMIT 1', [idempotencyKey]);
    if (!result[0]) return null;
    return mapRow(result[0] as Record<string, unknown>);
  },

  async findByExternalReference(externalReference: string): Promise<ChargeRecord | null> {
    const result = await db.query('SELECT * FROM pix_charges WHERE external_reference = ? LIMIT 1', [externalReference]);
    if (!result[0]) return null;
    return mapRow(result[0] as Record<string, unknown>);
  },

  async createCharge(input: CreateChargeInput, gatewayResult: GatewayCreateChargeResult): Promise<ChargeRecord> {
    await db.query(
      `INSERT INTO pix_charges (
        internal_charge_id, idempotency_key, player_identifier, product_id,
        amount_cents, currency, status, external_reference, gateway_name,
        gateway_charge_id, qr_code_base64, qr_code_text, expires_at,
        metadata_json, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
      [
        input.internalChargeId, input.idempotencyKey, input.playerIdentifier, input.productId,
        input.amountCents, input.currency, gatewayResult.status, gatewayResult.externalReference,
        gatewayResult.gatewayName, gatewayResult.gatewayChargeId, gatewayResult.qrCodeBase64,
        gatewayResult.qrCodeText, gatewayResult.expiresAt, JSON.stringify(input.metadata || {}),
      ],
    );
    const inserted = await db.query('SELECT * FROM pix_charges WHERE internal_charge_id = ? LIMIT 1', [input.internalChargeId]);
    return mapRow(inserted[0] as Record<string, unknown>);
  },

  /**
   * ═══════════════════════════════════════════════════════
   * RACE CONDITION GUARD — Atomic status update.
   *
   * Only updates if the current status is PENDING or CREATED.
   * If two webhooks arrive simultaneously (e.g. duplicate delivery),
   * only one UPDATE will match (affectedRows > 0).
   * The second call gets updated=false and is safely ignored.
   * ═══════════════════════════════════════════════════════
   */
  async atomicWebhookUpdate(params: {
    externalReference: string; newStatus: ChargeStatus;
    transactionId?: string; endToEndId?: string;
    gatewayChargeId: string; amountCents: number; currency: string;
  }): Promise<AtomicUpdateResult> {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT * FROM pix_charges WHERE external_reference = ? FOR UPDATE', [params.externalReference]);
      if (!rows[0]) {
        await connection.commit();
        return { record: null, updated: false, previousStatus: null };
      }
      const current = mapRow(rows[0]);
      if (params.gatewayChargeId !== current.gatewayChargeId || params.amountCents !== current.amountCents || params.currency !== current.currency) {
        throw new Error('provider_payment_mismatch');
      }
      if (!canTransition(current.status, params.newStatus)) {
        if (current.status === params.newStatus && needsGameNotification(current.status)) {
          await connection.query(`INSERT INTO payment_outbox (event_key, charge_id, payload_json, next_attempt_at)
            VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE event_key = VALUES(event_key)`,
            [`payment:${current.internalChargeId}:${current.status}`, current.internalChargeId, JSON.stringify(gamePayload(current))]);
        }
        await connection.commit();
        return { record: current, updated: false, previousStatus: current.status };
      }
      await connection.query(`UPDATE pix_charges SET status = ?, transaction_id = COALESCE(?, transaction_id),
        end_to_end_id = COALESCE(?, end_to_end_id), updated_at = NOW() WHERE internal_charge_id = ?`,
        [params.newStatus, params.transactionId ?? null, params.endToEndId ?? null, current.internalChargeId]);
      const updated = { ...current, status: params.newStatus, transactionId: params.transactionId ?? current.transactionId,
        endToEndId: params.endToEndId ?? current.endToEndId, updatedAt: new Date() };
      if (needsGameNotification(updated.status)) {
        const eventKey = `payment:${updated.internalChargeId}:${updated.status}`;
        await connection.query(`INSERT INTO payment_outbox (event_key, charge_id, payload_json, next_attempt_at)
          VALUES (?, ?, ?, NOW()) ON DUPLICATE KEY UPDATE event_key = VALUES(event_key)`,
          [eventKey, updated.internalChargeId, JSON.stringify(gamePayload(updated))]);
      }
      await connection.commit();
      return { record: updated, updated: true, previousStatus: current.status };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally { connection.release(); }
  },

  // Legacy — used by status sync route (no race guard needed there)
  async updateStatusByExternalReference(params: {
    externalReference: string;
    status: ChargeStatus;
    transactionId?: string;
    endToEndId?: string;
  }): Promise<ChargeRecord | null> {
    await db.query(
      `UPDATE pix_charges
       SET status         = ?,
           transaction_id = COALESCE(?, transaction_id),
           end_to_end_id  = COALESCE(?, end_to_end_id),
           updated_at     = NOW()
       WHERE external_reference = ?`,
      [params.status, params.transactionId ?? null, params.endToEndId ?? null, params.externalReference],
    );
    return this.findByExternalReference(params.externalReference);
  },

  /** Mark a charge as chargedback (payment reversed after being PAID) */
  async markChargedBack(internalChargeId: string): Promise<void> {
    await db.query(
      `UPDATE pix_charges SET status = 'CHARGEDBACK', updated_at = NOW() WHERE internal_charge_id = ?`,
      [internalChargeId],
    );
  },

  /** Check if an endToEndId was already processed (replay attack prevention) */
  async isEndToEndIdProcessed(endToEndId: string): Promise<boolean> {
    const result = await db.query(
      'SELECT 1 FROM pix_processed_events WHERE end_to_end_id = ? LIMIT 1',
      [endToEndId],
    );
    return result.length > 0;
  },

  /** Record a processed endToEndId to prevent replay */
  async recordProcessedEvent(endToEndId: string, chargeId: string): Promise<void> {
    await db.query(
      `INSERT IGNORE INTO pix_processed_events (end_to_end_id, charge_id, processed_at) VALUES (?, ?, NOW())`,
      [endToEndId, chargeId],
    );
  },

  /** Fetch all paid charges that haven't been delivered yet */
  async getPendingDeliveries(playerIdentifier: string): Promise<ChargeRecord[]> {
    const results = await db.query(
      `SELECT * FROM pix_charges WHERE player_identifier = ? AND status = 'PAID' AND delivered_at IS NULL ORDER BY created_at ASC`,
      [playerIdentifier]
    );
    return results.map(row => mapRow(row as Record<string, unknown>));
  },

  /** Mark a specific product charge as delivered to the player */
  async markAsDelivered(internalChargeId: string): Promise<boolean> {
    const result = await db.execute(
      `UPDATE pix_charges SET delivered_at = NOW() WHERE internal_charge_id = ? AND delivered_at IS NULL AND status = 'PAID'`,
      [internalChargeId]
    );
    return (result.affectedRows ?? 0) > 0;
  },
};
