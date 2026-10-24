import type { RequestHandler } from 'express';
import { InvalidWebhookSignatureError, WebhookSignatureValidator } from 'mercadopago';
import type { GatewayWebhookPayload } from './types.js';

export interface WebhookDependencies {
  secret: string;
  fetchPayment: (body: Record<string, unknown>) => Promise<GatewayWebhookPayload | null>;
  persistPayment: (payment: GatewayWebhookPayload) => Promise<{ updated: boolean }>;
}

/** Verify first; acknowledge only after the payment update and outbox commit. */
export function createPaymentWebhook(deps: WebhookDependencies): RequestHandler {
  return async (req, res) => {
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
      res.status(400).json({ error: 'invalid_payload' });
      return;
    }
    if (Object.hasOwn(req.body, '_simulate')) {
      res.status(400).json({ error: 'simulation_not_supported' });
      return;
    }
    const dataId = req.query['data.id'];
    const requestId = req.headers['x-request-id'];
    const signature = req.headers['x-signature'];
    if (!deps.secret || typeof dataId !== 'string' || !/^\d{1,32}$/.test(dataId)
      || typeof requestId !== 'string' || requestId.length > 200
      || typeof signature !== 'string' || signature.length > 512) {
      res.status(401).json({ error: 'invalid_webhook_signature' });
      return;
    }
    try {
      WebhookSignatureValidator.validate({
        xSignature: signature, xRequestId: requestId,
        dataId, secret: deps.secret, toleranceSeconds: 300,
      });
    } catch (error) {
      res.status(error instanceof InvalidWebhookSignatureError ? 401 : 503)
        .json({ error: 'invalid_webhook_signature' });
      return;
    }
    const bodyId = req.body.data?.id;
    if (req.body.type !== 'payment' || String(bodyId ?? '') !== dataId) {
      res.status(400).json({ error: 'notification_resource_mismatch' });
      return;
    }
    try {
      const payment = await deps.fetchPayment({ type: 'payment', data: { id: dataId } });
      if (!payment?.externalReference) {
        res.status(200).json({ ok: true, ignored: true });
        return;
      }
      const result = await deps.persistPayment(payment);
      res.status(200).json({ ok: true, updated: result.updated });
    } catch {
      // A non-2xx response asks the provider to retry; never log payment bodies.
      res.status(503).json({ error: 'payment_processing_unavailable' });
    }
  };
}
