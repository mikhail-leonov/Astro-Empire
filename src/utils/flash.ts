import type { Request, Response, NextFunction } from 'express';
import type { FlashMessage } from '../types/session';

/** Queue a flash message to show on the next page render. */
export function addFlash(req: Request, type: FlashMessage['type'], message: string): void {
  if (!req.session.flash) req.session.flash = [];
  req.session.flash.push({ type, message });
}

/** Move any queued flash messages into res.locals and clear them. */
export function flashMiddleware(req: Request, res: Response, next: NextFunction): void {
  const messages = req.session.flash ?? [];
  res.locals.flash = messages;
  if (messages.length) req.session.flash = [];
  next();
}
