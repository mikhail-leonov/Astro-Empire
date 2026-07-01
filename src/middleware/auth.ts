import type { Request, Response, NextFunction } from 'express';
import { addFlash } from '../utils/flash';

/** Block access unless the user is logged in. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session.userId) {
    next();
    return;
  }
  addFlash(req, 'error', 'Please log in to continue.');
  res.redirect('/login');
}

/** Block access unless the user is logged in AND holds the admin role. */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.session.userId && req.session.role === 'admin') {
    next();
    return;
  }
  addFlash(req, 'error', 'Admin access required.');
  res.redirect(req.session.userId ? '/account' : '/login');
}

/** Block access for users who are already logged in (login/register pages). */
export function requireGuest(req: Request, res: Response, next: NextFunction): void {
  if (req.session.userId) {
    res.redirect('/account');
    return;
  }
  next();
}

/** Expose the current user to all templates via res.locals.currentUser. */
export function loadUser(req: Request, res: Response, next: NextFunction): void {
  res.locals.currentUser = req.session.userId
    ? { id: req.session.userId, username: req.session.username, role: req.session.role }
    : null;
  next();
}
