import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';

test('database: concurrent payment notifications enqueue once, rollback mismatches and preserve delivery order',
  { skip: process.env.RUN_DB_TESTS !== '1' }, async () => {
    if (process.env.MYSQL_DATABASE !== 'autopay_ci') throw new Error('Integration tests require the isolated autopay_ci database');
    const { db, pool, ensureTables } = await import('../src/db.js');
    const { repository } = await import('../src/repository.js');
    const { createOutboxStore } = await import('../src/outboxStore.js');
    const id = `test-${crypto.randomUUID()}`;
    try {
      await ensureTables();
      await repository.createCharge({ internalChargeId: id, idempotencyKey: id, playerIdentifier: 'synthetic-player',
        productId: 'synthetic-item', amountCents: 1000, currency: 'BRL', expiresInSeconds: 600 }, {
        externalReference: id, gatewayName: 'synthetic', gatewayChargeId: '123', status: 'PENDING',
        qrCodeBase64: '', qrCodeText: 'synthetic-qr', expiresAt: new Date(Date.now() + 600_000),
      });
      const update = { externalReference: id, gatewayChargeId: '123', newStatus: 'PAID' as const, amountCents: 1000, currency: 'BRL' };
      await assert.rejects(repository.atomicWebhookUpdate({ ...update, amountCents: 1 }), /provider_payment_mismatch/);
      assert.equal((await repository.findByInternalId(id))?.status, 'PENDING');
      const results = await Promise.all(Array.from({ length: 12 }, () => repository.atomicWebhookUpdate(update)));
      assert.equal(results.filter(result => result.updated).length, 1);
      const [count] = await db.query<{ total: number }>('SELECT COUNT(*) AS total FROM payment_outbox WHERE charge_id = ?', [id]);
      assert.equal(Number(count.total), 1);
      await repository.atomicWebhookUpdate({ ...update, newStatus: 'REFUNDED' });
      const firstWorker = createOutboxStore();
      const secondWorker = createOutboxStore();
      const first = await firstWorker.claim();
      assert.equal(first?.eventKey, `payment:${id}:PAID`);
      assert.equal(await secondWorker.claim(), null);
      await firstWorker.retry(first!.id, 1);
      assert.equal(await secondWorker.claim(), null);
      await db.execute('UPDATE payment_outbox SET next_attempt_at = NOW() WHERE id = ?', [first!.id]);
      const retried = await secondWorker.claim();
      assert.equal(retried?.id, first!.id);
      await secondWorker.acknowledge(retried!.id);
      const refund = await firstWorker.claim();
      assert.equal(refund?.eventKey, `payment:${id}:REFUNDED`);
      await firstWorker.acknowledge(refund!.id);
      assert.equal(await firstWorker.claim(), null);
      assert.equal(await repository.markAsDelivered(id), false);
    } finally {
      await db.execute('DELETE FROM payment_outbox WHERE charge_id = ?', [id]);
      await db.execute('DELETE FROM pix_charges WHERE internal_charge_id = ?', [id]);
      await pool.end();
    }
  });
