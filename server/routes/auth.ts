/**
 * Authentication routes — PIN-only login.
 *
 * POST /api/v1/auth/login      — PIN login, returns JWT
 * POST /api/v1/auth/demo-login — Demo auto-login (gated on DEMO_MODE)
 * GET  /api/v1/auth/demo-mode  — Check if demo mode is enabled
 * GET  /api/v1/auth/me         — Current user info
 */

import { Express, Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { signToken, authMiddleware } from '../lib/auth';
import { rateLimit } from '../middleware/rate-limit';
import { validateBody } from '../middleware/validate';
import { LoginSchema } from '../lib/validation';
import { audit } from '../services/audit-log';
import { log } from '../utils/logger';

export function hashPin(pin: string): string {
  return crypto.createHash('sha256').update(pin.trim()).digest('hex');
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  name: 'loginLimit',
  message: 'Too many login attempts from this IP — please wait a few minutes and try again',
});

const LOCKOUT_THRESHOLD = 20;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const FAILURE_WINDOW_MS = 60 * 60 * 1000;

async function checkPinLockout(pinHash: string): Promise<Date | null> {
  const record = await prisma.failedPinAttempt.findUnique({ where: { pinHash } });
  if (!record || !record.lockedUntil) return null;
  if (record.lockedUntil.getTime() > Date.now()) return record.lockedUntil;

  await prisma.failedPinAttempt.update({
    where: { pinHash },
    data: { failureCount: 0, lockedUntil: null, firstFailAt: new Date() },
  });
  return null;
}

async function recordPinFailure(pinHash: string): Promise<void> {
  const now = new Date();
  const record = await prisma.failedPinAttempt.findUnique({ where: { pinHash } });

  if (!record) {
    await prisma.failedPinAttempt.create({
      data: { pinHash, failureCount: 1, firstFailAt: now, lastFailAt: now },
    });
    return;
  }

  const windowStart = now.getTime() - FAILURE_WINDOW_MS;
  if (record.lastFailAt.getTime() < windowStart) {
    await prisma.failedPinAttempt.update({
      where: { pinHash },
      data: { failureCount: 1, firstFailAt: now, lastFailAt: now, lockedUntil: null },
    });
    return;
  }

  const newCount = record.failureCount + 1;
  const lockedUntil =
    newCount >= LOCKOUT_THRESHOLD ? new Date(now.getTime() + LOCKOUT_DURATION_MS) : null;

  await prisma.failedPinAttempt.update({
    where: { pinHash },
    data: { failureCount: newCount, lastFailAt: now, lockedUntil },
  });

  if (lockedUntil) {
    log.warn('PIN locked due to failure threshold', { pinHashPrefix: pinHash.slice(0, 8), failureCount: newCount });
    void audit({ action: 'AUTH_PIN_LOCKED', targetType: 'Auth', details: { failureCount: newCount } });
  }
}

async function clearPinFailures(pinHash: string): Promise<void> {
  await prisma.failedPinAttempt.deleteMany({ where: { pinHash } }).catch(() => { /* best effort */ });
}

export function registerAuthRoutes(app: Express) {
  app.post(
    '/api/v1/auth/login',
    loginLimiter,
    validateBody(LoginSchema),
    async (req: Request, res: Response) => {
      try {
        const { pin } = req.validBody as { pin: string };
        const pinHash = hashPin(pin);

        const lockedUntil = await checkPinLockout(pinHash);
        if (lockedUntil) {
          const retryAfterSec = Math.ceil((lockedUntil.getTime() - Date.now()) / 1000);
          res.setHeader('Retry-After', String(retryAfterSec));
          return res.status(429).json({
            error: 'This account is temporarily locked due to repeated failures',
            code: 'PIN_LOCKED',
            retryAfter: retryAfterSec,
          });
        }

        const user = await prisma.appUser.findUnique({
          where: { pin: pinHash },
          include: { facility: true },
        });

        if (!user || user.status !== 'ACTIVE') {
          await recordPinFailure(pinHash);
          void audit({
            action: 'AUTH_LOGIN_FAILURE',
            targetType: 'Auth',
            ipAddress: req.ip ?? null,
            userAgent: req.headers['user-agent']?.toString() ?? null,
          });
          return res.status(401).json({ error: 'Invalid PIN' });
        }

        await clearPinFailures(pinHash);

        const token = signToken({
          userId: user.id,
          email: user.email || '',
          role: user.role,
          facilityId: user.facilityId,
        });

        log.event('User logged in', { userId: user.id, name: user.name });
        void audit({
          action: 'AUTH_LOGIN_SUCCESS',
          targetType: 'Auth',
          userId: user.id,
          facilityId: user.facilityId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent']?.toString() ?? null,
        });

        res.json({
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            facilityId: user.facilityId,
            facilityName: user.facility.name,
          },
        });
      } catch (error) {
        log.error(error, { operation: 'login' });
        res.status(500).json({ error: 'Login failed' });
      }
    },
  );

  app.post('/api/v1/auth/demo-login', async (_req: Request, res: Response) => {
    if (process.env.DEMO_MODE !== 'true') {
      return res.status(404).json({ error: 'Not found' });
    }

    try {
      let user = await prisma.appUser.findFirst({
        where: { id: 'demo-user', status: 'ACTIVE' },
        include: { facility: true },
      });
      if (!user) {
        user = await prisma.appUser.findFirst({
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          include: { facility: true },
        });
      }

      if (!user) {
        return res.status(503).json({
          error: 'Demo mode enabled but no users exist. Run `npm run demo:seed` first.',
        });
      }

      const token = signToken({
        userId: user.id,
        email: user.email || '',
        role: user.role,
        facilityId: user.facilityId,
      });

      log.event('Demo auto-login', { userId: user.id, name: user.name });
      void audit({ action: 'AUTH_DEMO_LOGIN', targetType: 'Auth', userId: user.id, facilityId: user.facilityId });

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          facilityId: user.facilityId,
          facilityName: user.facility.name,
        },
      });
    } catch (error) {
      log.error(error, { operation: 'demoLogin' });
      res.status(500).json({ error: 'Demo login failed' });
    }
  });

  app.get('/api/v1/auth/demo-mode', (_req: Request, res: Response) => {
    res.json({ enabled: process.env.DEMO_MODE === 'true' });
  });

  app.get('/api/v1/auth/me', authMiddleware, async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const user = await prisma.appUser.findUnique({
        where: { id: req.user.userId },
        include: { facility: true },
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        facilityId: user.facilityId,
        facilityName: user.facility.name,
      });
    } catch (error) {
      log.error(error, { operation: 'getMe' });
      res.status(500).json({ error: 'Failed to fetch user' });
    }
  });
}
