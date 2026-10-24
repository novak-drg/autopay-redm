import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from './db.js';
import { config } from './config.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminUser {
  id: number;
  username: string;
  password_hash: string;
  role: 'super_admin' | 'admin';
  is_active: number;
  failed_attempts: number;
  locked_until: Date | null;
}

interface JwtPayload {
  sub: number;
  username: string;
  role: string;
  iat?: number;
  exp?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCESS_TOKEN_TTL_SECONDS  = 15 * 60;          // 15 minutes
const REFRESH_TOKEN_TTL_DAYS    = 7;
const FAILED_LOGIN_LOCKOUT      = 10;                // lock after N attempts
const LOCKOUT_MINUTES           = 30;
const BCRYPT_ROUNDS             = 12;
const COOKIE_SAME_SITE          = 'strict' as const;
const SAFE_USERNAME             = /^[a-zA-Z0-9_-]{3,64}$/;
const CSRF_HEADER               = 'x-admin-requested-with';
const CSRF_HEADER_VALUE         = 'XMLHttpRequest';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const jwtSecret = (): string => {
  const s = config.adminJwtSecret;
  if (!s || s.length < 32) throw new Error('ADMIN_JWT_SECRET missing or too short');
  return s;
};

const signAccess = (user: AdminUser): string =>
  jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    jwtSecret(),
    { expiresIn: ACCESS_TOKEN_TTL_SECONDS, algorithm: 'HS256' }
  );

const hashToken = (raw: string): string =>
  crypto.createHash('sha256').update(raw).digest('hex');

const auditLog = async (userId: number | null, username: string | null, action: string, ip: string, details?: object) => {
  try {
    await db.execute(
      'INSERT INTO admin_audit_log (user_id, username, action, ip_address, details, created_at) VALUES (?,?,?,?,?,NOW())',
      [userId, username, action, ip, details ? JSON.stringify(details) : null]
    );
  } catch { /* audit must never crash business logic */ }
};

const ipOf = (req: Request): string => {
  // Ignora x-forwarded-for caso trust proxy seja muito permissivo e não se tenha controle estrito do rev-proxy.
  // Prioriza o req.ip validado pelo Express (que depende do trust proxy configurado em index.ts adequadamente).
  const extracted = req.ip || req.socket.remoteAddress || 'unknown';
  // Strip ipv6 prefix para localhost e logs consistentes
  return extracted.startsWith('::ffff:') ? extracted.slice(7) : extracted;
};

const safeErrorResponse = (res: Response, status: number, code: string): void => {
  res.status(status).json({ error: code });
};

// ─── CSRF check for mutation endpoints ───────────────────────────────────────
// Requires custom header — browsers cannot set this on cross-origin requests.

const requireCsrfHeader = (req: Request, res: Response, next: NextFunction): void => {
  if (req.header(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    safeErrorResponse(res, 403, 'forbidden');
    return;
  }
  next();
};

// ─── Auth middleware (exported — used by other routers) ───────────────────────

export const requireAdminSession = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = req.cookies?.admin_access;
  if (!token) { safeErrorResponse(res, 401, 'unauthorized'); return; }

  try {
    const payload = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] }) as unknown as JwtPayload;
    const [account] = await db.query<AdminUser>('SELECT id,username,role,is_active FROM admin_users WHERE id = ? LIMIT 1', [payload.sub]);
    if (!account?.is_active) { safeErrorResponse(res, 401, 'unauthorized'); return; }
    payload.role = account.role;
    payload.username = account.username;
    (req as Request & { adminUser: JwtPayload }).adminUser = payload;
    next();
  } catch {
    res.clearCookie('admin_access');
    safeErrorResponse(res, 401, 'unauthorized');
  }
};

export const requireRole = (role: 'super_admin') =>
  (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as Request & { adminUser?: JwtPayload }).adminUser;
    if (!user || user.role !== role) {
      safeErrorResponse(res, 403, 'forbidden');
      return;
    }
    next();
  };

// ─── Rate limiters ────────────────────────────────────────────────────────────

const loginRateLimit = rateLimit({
  windowMs: 60_000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const LoginSchema = z.object({
  username: z.string().regex(SAFE_USERNAME, 'invalid username'),
  password: z.string().min(8, 'Senha deve ter no mínimo 8 caracteres').regex(/[a-zA-Z]/, 'Senha precisa conter letras').max(256),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const adminAuthRouter = Router();

// POST /v1/admin/auth/login
adminAuthRouter.post(
  '/login',
  loginRateLimit,
  requireCsrfHeader,
  async (req: Request, res: Response) => {
    const ip = ipOf(req);
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      // Identical response regardless of reason — no username enumeration
      await new Promise(r => setTimeout(r, 300));
      safeErrorResponse(res, 401, 'invalid_credentials');
      return;
    }

    const { username, password } = parsed.data;

    const [user] = await db.query<AdminUser>(
      'SELECT id,username,password_hash,role,is_active,failed_attempts,locked_until FROM admin_users WHERE username = ? LIMIT 1',
      [username]
    );

    // Always run bcrypt even when user doesn't exist — timing-safe
    const hashToCheck = user?.password_hash ?? '$2a$12$invalidhashxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    const isValid     = await bcrypt.compare(password, hashToCheck);

    if (!user || !isValid || !user.is_active) {
      if (user) {
        const newAttempts = (user.failed_attempts ?? 0) + 1;
        const lockClause  = newAttempts >= FAILED_LOGIN_LOCKOUT
          ? `, locked_until = DATE_ADD(NOW(), INTERVAL ${LOCKOUT_MINUTES} MINUTE)`
          : '';
        await db.execute(
          `UPDATE admin_users SET failed_attempts = ?${lockClause} WHERE id = ?`,
          [newAttempts, user.id]
        );
        await auditLog(user.id, username, 'login_failed', ip, { attempts: newAttempts });
      } else {
        await auditLog(null, username, 'login_attempt_unknown_user', ip);
      }

      safeErrorResponse(res, 401, 'invalid_credentials');
      return;
    }

    // Check account lock
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await auditLog(user.id, username, 'login_blocked_locked', ip);
      safeErrorResponse(res, 401, 'invalid_credentials');
      return;
    }

    // Success — reset failed attempts, issue tokens
    await db.execute(
      'UPDATE admin_users SET failed_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?',
      [user.id]
    );

    const accessToken  = signAccess(user);
    const refreshRaw   = crypto.randomBytes(48).toString('hex');
    const refreshHash  = hashToken(refreshRaw);
    const refreshExp   = new Date();
    refreshExp.setDate(refreshExp.getDate() + REFRESH_TOKEN_TTL_DAYS);

    await db.execute(
      'INSERT INTO admin_refresh_tokens (user_id, token_hash, ip_address, expires_at) VALUES (?,?,?,?)',
      [user.id, refreshHash, ip, refreshExp]
    );

    await auditLog(user.id, username, 'login_success', ip);

    res.cookie('admin_access', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: COOKIE_SAME_SITE,
      maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
      path: '/',
    });

    res.cookie('admin_refresh', refreshRaw, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: COOKIE_SAME_SITE,
      maxAge: REFRESH_TOKEN_TTL_DAYS * 86400 * 1000,
      path: '/api/proxy',
    });

    res.json({ ok: true, username: user.username, role: user.role });
  }
);

// POST /v1/admin/auth/refresh
adminAuthRouter.post('/refresh', requireCsrfHeader, async (req: Request, res: Response) => {
  const rawToken = req.cookies?.admin_refresh;
  if (!rawToken) { safeErrorResponse(res, 401, 'unauthorized'); return; }

  const tokenHash = hashToken(rawToken);
  const ip        = ipOf(req);

  const [stored] = await db.query<{
    id: number; user_id: number; expires_at: Date; revoked: number;
  }>(
    'SELECT id,user_id,expires_at,revoked FROM admin_refresh_tokens WHERE token_hash = ? LIMIT 1',
    [tokenHash]
  );

  if (!stored || stored.revoked || new Date(stored.expires_at) < new Date()) {
    res.clearCookie('admin_access');
    res.clearCookie('admin_refresh');
    safeErrorResponse(res, 401, 'unauthorized');
    return;
  }

  const [user] = await db.query<AdminUser>(
    'SELECT id,username,role,is_active FROM admin_users WHERE id = ? LIMIT 1',
    [stored.user_id]
  );

  if (!user || !user.is_active) {
    safeErrorResponse(res, 401, 'unauthorized');
    return;
  }

  // Rotate: revoke old, issue new
  const consumed = await db.execute('UPDATE admin_refresh_tokens SET revoked = 1 WHERE id = ? AND revoked = 0 AND expires_at > NOW()', [stored.id]);
  if (consumed.affectedRows !== 1) { safeErrorResponse(res, 401, 'unauthorized'); return; }

  const newRefreshRaw  = crypto.randomBytes(48).toString('hex');
  const newRefreshHash = hashToken(newRefreshRaw);
  const newExp         = new Date();
  newExp.setDate(newExp.getDate() + REFRESH_TOKEN_TTL_DAYS);

  await db.execute(
    'INSERT INTO admin_refresh_tokens (user_id, token_hash, ip_address, expires_at) VALUES (?,?,?,?)',
    [user.id, newRefreshHash, ip, newExp]
  );

  const accessToken = signAccess(user);

  res.cookie('admin_access', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: COOKIE_SAME_SITE,
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
    path: '/',
  });

  res.cookie('admin_refresh', newRefreshRaw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: COOKIE_SAME_SITE,
    maxAge: REFRESH_TOKEN_TTL_DAYS * 86400 * 1000,
    path: '/api/proxy',
  });

  await auditLog(user.id, user.username, 'token_refreshed', ip);
  res.json({ ok: true });
});

// POST /v1/admin/auth/logout
adminAuthRouter.post('/logout', requireCsrfHeader, async (req: Request, res: Response) => {
  const rawToken = req.cookies?.admin_refresh;
  if (rawToken) {
    const tokenHash = hashToken(rawToken);
    await db.execute('UPDATE admin_refresh_tokens SET revoked = 1 WHERE token_hash = ?', [tokenHash]);
    const token = req.cookies?.admin_access;
    if (token) {
      try {
        const payload = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] }) as unknown as JwtPayload;
        await auditLog(payload.sub, payload.username, 'logout', ipOf(req));
      } catch { /* expired token — still clear cookies */ }
    }
  }

  res.clearCookie('admin_access', { path: '/' });
  res.clearCookie('admin_refresh', { path: '/api/proxy' });
  res.json({ ok: true });
});

// GET /v1/admin/auth/me
adminAuthRouter.get('/me', requireAdminSession, (req: Request, res: Response) => {
  const user = (req as Request & { adminUser: JwtPayload }).adminUser;
  res.json({ id: user.sub, username: user.username, role: user.role });
});
