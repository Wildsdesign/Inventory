/**
 * JWT authentication helpers.
 *
 * Tokens include: userId, email, role, facilityId.
 * JWT_SECRET must be 32+ characters in production.
 */

import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { log } from '../utils/logger';

function loadJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  const env = process.env.NODE_ENV;

  if (!secret || secret.length < 32) {
    if (env === 'production') {
      console.error(
        '[FATAL] JWT_SECRET is missing or shorter than 32 characters. ' +
          'Generate one with: openssl rand -base64 48',
      );
      process.exit(1);
    }
    log.warn(
      'JWT_SECRET is missing or weak — using an ephemeral dev secret. ' +
        'This is NOT safe for production.',
    );
    return 'dev-secret-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  return secret;
}

const JWT_SECRET = loadJwtSecret();

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  facilityId: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.user && req.facilityId) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  (req as Request & { user?: JwtPayload }).user = payload;
  next();
}

// Augment Express Request type
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      facilityId?: string;
      user?: JwtPayload;
    }
  }
}
