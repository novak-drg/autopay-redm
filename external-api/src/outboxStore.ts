import { db, pool } from './db.js';
import type { RowDataPacket } from 'mysql2';
import { config } from './config.js';
import { processDelivery, sendGameEvent, workerId, type OutboxStore } from './deliveryOutbox.js';

export function createOutboxStore(): OutboxStore {
  const lease = workerId();
  return {
    async claim() {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const [rows] = await connection.query<RowDataPacket[]>(`SELECT e.id,e.event_key,e.payload_json,e.attempts FROM payment_outbox e
          WHERE e.delivered_at IS NULL AND e.next_attempt_at <= NOW()
          AND (e.locked_until IS NULL OR e.locked_until < NOW())
          AND NOT EXISTS (SELECT 1 FROM payment_outbox previous WHERE previous.charge_id = e.charge_id
            AND previous.id < e.id AND previous.delivered_at IS NULL)
          ORDER BY e.id LIMIT 1 FOR UPDATE SKIP LOCKED`);
        const row = rows[0];
        if (!row) { await connection.commit(); return null; }
        await connection.query('UPDATE payment_outbox SET locked_by = ?, locked_until = DATE_ADD(NOW(), INTERVAL 60 SECOND) WHERE id = ?', [lease, row.id]);
        await connection.commit();
        return { id: Number(row.id), eventKey: String(row.event_key), attempts: Number(row.attempts),
          payload: typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json };
      } catch (error) { await connection.rollback(); throw error; }
      finally { connection.release(); }
    },
    async acknowledge(id) {
      await db.execute('UPDATE payment_outbox SET delivered_at = NOW(), locked_by = NULL, locked_until = NULL WHERE id = ? AND locked_by = ?', [id, lease]);
    },
    async retry(id, attempts) {
      const delay = Math.min(3600, 2 ** Math.min(attempts, 11));
      await db.execute(`UPDATE payment_outbox SET attempts = ?, next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
        locked_by = NULL, locked_until = NULL WHERE id = ? AND locked_by = ?`, [attempts, delay, id, lease]);
    },
  };
}

export function startDeliveryWorker(): () => void {
  if (!config.fivemCallbackUrl) return () => {};
  const store = createOutboxStore();
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      for (let count = 0; count < 10; count++) {
        if (!await processDelivery(store, event => sendGameEvent(event, config.fivemCallbackUrl, config.fivemCallbackToken))) break;
      }
    } catch { console.error('[delivery-worker] Batch failed; events remain queued.'); }
    finally { running = false; }
  }, 2000);
  timer.unref();
  return () => clearInterval(timer);
}
