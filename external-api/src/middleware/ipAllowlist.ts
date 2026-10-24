/**
 * middleware/ipAllowlist.ts
 * Restringe o endpoint /v1/webhooks/pix a IPs conhecidos do Mercado Pago.
 * WEBHOOK_ALLOWED_IPS: lista separada por vírgulas de IPs/prefixos permitidos.
 * Se vazio, todos os IPs são aceitos (modo dev).
 */
import { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';

export const webhookIpAllowlist = (req: Request, res: Response, next: NextFunction): void => {
  if (!config.webhookAllowedIps || config.webhookAllowedIps.length === 0) {
    next();
    return;
  }

  const remoteIp = (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');

  const allowed = config.webhookAllowedIps.includes(remoteIp);

  if (!allowed) {
    console.warn(`[SECURITY] Webhook rejected from non-allowlisted IP: ${remoteIp}`);
    // Return a generic 404 — do not reveal the endpoint exists
    res.status(404).json({ error: 'not_found' });
    return;
  }

  next();
};
