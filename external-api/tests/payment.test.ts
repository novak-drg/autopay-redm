import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import express, { type Request } from 'express';
import type { AddressInfo } from 'node:net';
import { canTransition } from '../src/paymentPolicy.js';
import { createPaymentWebhook } from '../src/paymentWebhook.js';
import { createRequestSignature, requestManifest } from '../src/requestSignature.js';
import { processDelivery, sendGameEvent, type OutboxEvent } from '../src/deliveryOutbox.js';

const secret = crypto.randomBytes(32).toString('hex');
async function withServer(app: express.Express, run: (url: string) => Promise<void>) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
function providerHeaders(id = '123', timestamp = String(Math.floor(Date.now() / 1000))) {
  const requestId = 'synthetic-request';
  const manifest = `id:${id};request-id:${requestId};ts:${timestamp};`;
  return { 'Content-Type': 'application/json', 'x-request-id': requestId,
    'x-signature': `ts=${timestamp},v1=${crypto.createHmac('sha256', secret).update(manifest).digest('hex')}` };
}
const payment = { externalReference: 'charge-test', gatewayChargeId: '123', status: 'PAID' as const, amountCents: 1000, currency: 'BRL' };

test('payment state rejects duplicate grants and payment regressions, allows refund and late approval', () => {
  assert.equal(canTransition('PENDING', 'PAID'), true);
  assert.equal(canTransition('PAID', 'PAID'), false);
  assert.equal(canTransition('PAID', 'PENDING'), false);
  assert.equal(canTransition('PAID', 'REFUNDED'), true);
  assert.equal(canTransition('REFUNDED', 'PAID'), false);
  assert.equal(canTransition('EXPIRED', 'PAID'), true);
});

test('signed webhook waits for persistence and rejects simulation, stale signatures and resource substitution', async () => {
  let calls = 0;
  const app = express();
  app.use(express.json());
  app.post('/webhook', createPaymentWebhook({ secret, fetchPayment: async () => payment,
    persistPayment: async () => { calls++; return { updated: calls === 1 }; } }));
  await withServer(app, async url => {
    const send = (headers: Record<string, string>, body: unknown, query = '?data.id=123') => fetch(url + '/webhook' + query,
      { method: 'POST', headers, body: JSON.stringify(body) });
    const body = { type: 'payment', data: { id: '123' } };
    assert.equal((await send({ 'Content-Type': 'application/json' }, body)).status, 401);
    assert.equal((await send(providerHeaders(), { ...body, _simulate: true })).status, 400);
    assert.equal((await send(providerHeaders('123', String(Math.floor(Date.now() / 1000) - 600)), body)).status, 401);
    assert.equal((await send(providerHeaders(), { type: 'payment', data: { id: '456' } })).status, 400);
    assert.equal((await send(providerHeaders(), body, '?data.id=123&data.id=456')).status, 401);
    const first = await send(providerHeaders(), body);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true, updated: true });
    const duplicate = await send(providerHeaders(), body);
    assert.deepEqual(await duplicate.json(), { ok: true, updated: false });
    assert.equal(calls, 2);
  });
});

test('persistence failures return retryable errors instead of acknowledging a lost payment', async () => {
  const app = express(); app.use(express.json());
  app.post('/webhook', createPaymentWebhook({ secret, fetchPayment: async () => payment,
    persistPayment: async () => { throw new Error('synthetic database outage'); } }));
  await withServer(app, async url => {
    const result = await fetch(url + '/webhook?data.id=123', { method: 'POST', headers: providerHeaders(),
      body: JSON.stringify({ type: 'payment', data: { id: '123' } }) });
    assert.equal(result.status, 503);
    assert.deepEqual(await result.json(), { error: 'payment_processing_unavailable' });
  });
});

test('service signatures bind method, URL and body and consume nonces once', async () => {
  const consumed = new Set<string>();
  const app = express();
  app.use(express.json({ verify: (req, _res, bytes) => { (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(bytes); } }));
  app.use(createRequestSignature({ secret, consumeNonce: async nonce => {
    if (consumed.has(nonce)) return false; consumed.add(nonce); return true;
  } }));
  app.post('/service', (_req, res) => { res.json({ ok: true }); });
  await withServer(app, async url => {
    const nonce = crypto.randomBytes(32).toString('hex');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = JSON.stringify({ productId: 'synthetic-item', amountCents: 1000 });
    const signature = crypto.createHmac('sha256', secret).update(requestManifest(nonce, timestamp, 'POST', '/service', Buffer.from(body))).digest('hex');
    const headers = { 'Content-Type': 'application/json', 'x-request-nonce': nonce, 'x-request-time': timestamp, 'x-request-sig': signature };
    assert.equal((await fetch(url + '/service?tampered=true', { method: 'POST', headers, body })).status, 401);
    assert.equal((await fetch(url + '/service', { method: 'POST', headers, body: body.replace('1000', '1') })).status, 401);
    assert.equal((await fetch(url + '/service', { method: 'POST', headers, body })).status, 200);
    assert.equal((await fetch(url + '/service', { method: 'POST', headers, body })).status, 401);
  });
});

test('outbox acknowledges only successful deliveries and retries failures with the same event key', async () => {
  const event: OutboxEvent = { id: 1, eventKey: 'payment:synthetic:PAID', attempts: 0, payload: { status: 'PAID' } };
  let acknowledgements = 0; let retries = 0;
  const store = { claim: async () => event, acknowledge: async () => { acknowledgements++; }, retry: async (_id: number, attempts: number) => { retries = attempts; } };
  await processDelivery(store, async () => { throw new Error('synthetic network outage'); });
  assert.equal(acknowledgements, 0); assert.equal(retries, 1);
  await processDelivery(store, async received => { assert.equal(received.eventKey, event.eventKey); });
  assert.equal(acknowledgements, 1);
});

test('game callbacks keep payload in POST body and forbid redirects', async () => {
  const event: OutboxEvent = { id: 1, eventKey: 'payment:synthetic:PAID', attempts: 0, payload: { chargeId: 'synthetic', status: 'PAID' } };
  const fetcher: typeof fetch = async (_url, options) => {
    assert.equal(options?.method, 'POST'); assert.equal(options?.redirect, 'error');
    assert.equal((options?.headers as Record<string, string>)['Idempotency-Key'], event.eventKey);
    assert.equal(JSON.parse(options?.body as string).chargeId, 'synthetic');
    return new Response(null, { status: 204 });
  };
  await sendGameEvent(event, 'https://game.example.com/payments', 'synthetic-token', fetcher);
});
