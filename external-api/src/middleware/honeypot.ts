/**
 * middleware/honeypot.ts
 * Catches scanner/attacker traffic on plausible-looking but non-existent routes.
 * Any hit here is 100% illegitimate — real Lua client only uses known paths.
 * Offending IPs are auto-blocked for BLOCK_DURATION_MS.
 */
import { NextFunction, Request, Response, Router } from 'express';
import { config } from '../config.js';

const blocked = new Map<string, number>(); // ip → block-until timestamp
const BLOCK_DURATION_MS = 60 * 60 * 1000; // 1 hour

const HONEYPOT_PATHS = [
  '/admin',
  '/api/v1/users',
  '/swagger',
  '/v1/auth',
  '/v1/login',
  '/wp-admin',
  '/actuator',
  '/.env',
  '/config',
  '/debug',
];

// Auto-block check middleware — applies to all routes
export const blocklistCheck = (req: Request, res: Response, next: NextFunction): void => {
  const ip = req.ip || req.socket.remoteAddress || '';
  const until = blocked.get(ip);

  if (until && Date.now() < until) {
    res.status(404).end();
    return;
  }

  if (until) blocked.delete(ip); // expired
  next();
};

const alertDiscord = (ip: string, method: string, path: string): void => {
  if (!config.discordAlertWebhook) return;

  fetch(config.discordAlertWebhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: '🚨 Scanner Detected',
        color: 0xff0000,
        fields: [
          { name: 'IP', value: `\`${ip}\``, inline: true },
          { name: 'Request', value: `\`${method} ${path}\``, inline: true },
          { name: 'Blocked Until', value: `<t:${Math.floor((Date.now() + BLOCK_DURATION_MS) / 1000)}:R>`, inline: true },
        ],
      }],
    }),
  }).catch(() => { /* do not crash on webhook failure */ });
};

export const honeypotRouter = Router();

HONEYPOT_PATHS.forEach(p => {
  honeypotRouter.all(`${p}*`, (req: Request, res: Response) => {
    const ip = req.ip || req.socket.remoteAddress || '';
    console.warn(`[HONEYPOT] Scanner from ${ip}: ${req.method} ${req.path}`);

    blocked.set(ip, Date.now() + BLOCK_DURATION_MS);
    alertDiscord(ip, req.method, req.path);

    res.status(404).json({ error: 'not_found' });
  });
});
