/**
 * In-process rate limiter. Per-process only — single App Service deployment.
 */

import { Request, Response, NextFunction } from 'express';
import { log } from '../utils/logger';

interface Bucket {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyFn?: (req: Request) => string;
  message?: string;
  name?: string;
}

function defaultKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function userKey(req: Request): string {
  return req.user?.userId ? `user:${req.user.userId}` : `ip:${defaultKey(req)}`;
}

export function rateLimit(options: RateLimitOptions) {
  const {
    windowMs,
    max,
    keyFn = defaultKey,
    message = 'Too many requests — try again later',
    name = 'rateLimit',
  } = options;

  const buckets = new Map<string, Bucket>();
  const SWEEP_THRESHOLD = 1000;

  function sweep(now: number) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    const key = keyFn(req);
    const now = Date.now();

    if (buckets.size > SWEEP_THRESHOLD) sweep(now);

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count++;

    const remaining = Math.max(0, max - bucket.count);
    const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(retryAfterSec));
      log.warn(`${name} — rate limit exceeded`, { key, path: req.path, count: bucket.count, max });
      return res.status(429).json({
        error: message,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: retryAfterSec,
      });
    }

    next();
  };
}
