import crypto from 'node:crypto';
import type { RequestHandler, Request } from 'express';
export interface SignatureDependencies {
  secret: string;
  consumeNonce: (nonce: string) => Promise<boolean>;
  now?: () => number;
}
export const requestManifest = (nonce: string, timestamp: string, method: string, path: string, body: Buffer): string =>
  [nonce, timestamp, method.toUpperCase(), path, crypto.createHash('sha256').update(body).digest('hex')].join('\n');
export function createRequestSignature(deps: SignatureDependencies): RequestHandler {
  return async (req, res, next) => {
    const nonce = req.header('x-request-nonce') || '';
    const timestamp = req.header('x-request-time') || '';
    const signature = req.header('x-request-sig') || '';
    const now = Math.floor((deps.now?.() ?? Date.now()) / 1000);
    if (!/^[a-f0-9]{64}$/.test(nonce) || !/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)
      || Math.abs(now - Number(timestamp)) > 30) {
      res.status(401).json({ error: 'invalid_request_signature' }); return;
    }
    const body = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    const expected = crypto.createHmac('sha256', deps.secret)
      .update(requestManifest(nonce, timestamp, req.method, req.originalUrl, body)).digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex'))) {
      res.status(401).json({ error: 'invalid_request_signature' }); return;
    }
    try {
      if (!await deps.consumeNonce(nonce)) {
        res.status(401).json({ error: 'request_already_processed' }); return;
      }
      next();
    } catch { res.status(503).json({ error: 'signature_storage_unavailable' }); }
  };
}
