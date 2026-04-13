/**
 * Facility context middleware.
 *
 * Extracts facilityId from a verified JWT Bearer token.
 * Pre-OIDC: falls through to demo defaults when no token is present.
 */

import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/auth';

const BYPASS_PATHS = new Set(['/v1/auth/login', '/health']);

function isBypassPath(path: string): boolean {
  if (BYPASS_PATHS.has(path)) return true;
  if (path.startsWith('/v1/auth/')) return true;
  return false;
}

const DEFAULT_FACILITY_ID = 'demo-facility';
const DEFAULT_USER = {
  userId: 'demo-user',
  email: '',
  role: 'ADMIN',
  facilityId: DEFAULT_FACILITY_ID,
};

export function facilityContext(req: Request, res: Response, next: NextFunction) {
  if (isBypassPath(req.path)) {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const payload = verifyToken(token);

    if (payload && payload.facilityId) {
      req.facilityId = payload.facilityId;
      req.user = payload;
      return next();
    }
  }

  // Pre-OIDC: fall through with demo defaults
  req.facilityId = DEFAULT_FACILITY_ID;
  req.user = DEFAULT_USER;
  return next();
}
