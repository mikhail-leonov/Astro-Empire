import type { Request, Response, NextFunction } from 'express';

export type FlashType = 'success' | 'error' | 'info';

export function addFlash(req: Request, type: FlashType, message: string): void {
  if (!req.session.flash) req.session.flash = [];
  req.session.flash.push({ type, message });
}

/** Exposes queued flash messages to templates via res.locals.flashes, then clears them. */
export function flashMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.locals.flashes = req.session.flash || [];
  req.session.flash = [];
  next();
}
