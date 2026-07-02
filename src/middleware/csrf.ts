import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Issues a per-session CSRF token (exposed as res.locals.csrfToken) and
 * verifies it on every state-changing request.
 *
 * FIX: on failure this used to always `res.render('error', ...)`, returning
 * an HTML page even for /api/galaxy/* routes. Every API client call does
 * `fetch(...).then(r => r.json())`, so a bad/missing CSRF token surfaced as
 * an opaque "Unexpected token '<'" JSON-parse crash instead of the real
 * "invalid CSRF token" reason. API routes now get a JSON 403 instead.
 */
export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (MUTATING.has(req.method.toUpperCase())) {
    const sent =
      (req.body && typeof req.body._csrf === 'string' ? req.body._csrf : '') ||
      (typeof req.headers['x-csrf-token'] === 'string' ? (req.headers['x-csrf-token'] as string) : '');

    if (!sent || !safeEqual(sent, req.session.csrfToken)) {
      if (req.path.startsWith('/api/')) {
        res.status(403).json({ ok: false, error: 'Invalid or missing security token. Please reload and try again.' });
        return;
      }
      res.status(403).render('error', {
        title: 'Forbidden',
        code: 403,
        message: 'Security token missing or invalid. Please reload the page and try again.',
      });
      return;
    }
  }

  next();
}
