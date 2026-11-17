import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function constantTimeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createApiTokenMiddleware(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const provided = req.header('x-api-token') || '';
    if (!provided || !constantTimeTokenEqual(provided, expectedToken)) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Valid x-api-token header is required for this endpoint.',
      });
      return;
    }
    next();
  };
}
