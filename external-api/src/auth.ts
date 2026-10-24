import { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { createHash, timingSafeEqual } from 'node:crypto';

export const requireServiceAuth = (req: Request, res: Response, next: NextFunction): void => {
  const auth = req.header('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');

  if (!token || !timingSafeEqual(createHash('sha256').update(token).digest(), createHash('sha256').update(config.serviceToken).digest())) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  next();
};
