/**
 * Zod validation helper for Express routes.
 */

import { Request, Response, NextFunction } from 'express';
import type { ZodTypeAny, ZodError } from 'zod';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      validBody?: unknown;
    }
  }
}

function formatIssues(err: ZodError) {
  return err.issues.map((i) => ({
    path: i.path,
    message: i.message,
    code: i.code,
  }));
}

export function validateBody<T extends ZodTypeAny>(schema: T) {
  return function validateBodyMiddleware(req: Request, res: Response, next: NextFunction) {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        code: 'VALIDATION_ERROR',
        issues: formatIssues(parsed.error),
      });
    }
    req.validBody = parsed.data;
    next();
  };
}
