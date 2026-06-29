import type { Request, Response } from 'express';
import * as userService from '../services/userService';
import { validateRegistration, validateLogin } from '../utils/validation';
import { addFlash } from '../utils/flash';
import { config } from '../config';

/* ---------------------------------------------------------- home */
export function home(_req: Request, res: Response): void {
  res.render('index', { title: 'Astro Empire' });
}

/* ---------------------------------------------------------- register */
export function showRegister(_req: Request, res: Response): void {
  res.render('register', { title: 'Create account', errors: {}, old: {} });
}

export async function register(req: Request, res: Response): Promise<void> {
  const { valid, errors, values } = validateRegistration(req.body);
  if (!valid) {
    res.status(422).render('register', { title: 'Create account', errors, old: values });
    return;
  }

  const result = await userService.register({
    username: values.username,
    email: values.email,
    password: String(req.body.password ?? ''),
  });

  if (!result.ok) {
    res.status(409).render('register', {
      title: 'Create account',
      errors: { [result.field]: result.error },
      old: values,
    });
    return;
  }

  // Log the new user straight in.
  req.session.userId = result.userId;
  req.session.username = values.username;
  addFlash(req, 'success', `Welcome aboard, Commander ${values.username}.`);
  res.redirect('/account');
}

/* ---------------------------------------------------------- login */
export function showLogin(_req: Request, res: Response): void {
  res.render('login', { title: 'Log in', errors: {}, old: {} });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { valid, errors, values } = validateLogin(req.body);
  if (!valid) {
    res.status(422).render('login', { title: 'Log in', errors, old: values });
    return;
  }

  const result = await userService.authenticate(values.identifier, String(req.body.password ?? ''));
  if (!result.ok) {
    res.status(401).render('login', {
      title: 'Log in',
      errors: { _form: 'Invalid credentials. Check your username / email and password.' },
      old: values,
    });
    return;
  }

  req.session.userId = result.user.id;
  req.session.username = result.user.username;
  addFlash(req, 'success', 'Logged in. The galaxy awaits.');
  res.redirect('/account');
}

/* ---------------------------------------------------------- logout */
export function logout(req: Request, res: Response): void {
  req.session.destroy(() => {
    res.clearCookie(config.session.name);
    res.redirect('/login');
  });
}

/* ---------------------------------------------------------- account */
export async function account(req: Request, res: Response): Promise<void> {
  const userId = req.session.userId as number;
  const user = await userService.getProfile(userId);

  if (!user) {
    // Account no longer exists; clear the stale session.
    req.session.destroy(() => {
      res.clearCookie(config.session.name);
      res.redirect('/login');
    });
    return;
  }

  res.render('account', { title: 'Account', account: user });
}

/* ---------------------------------------------------------- delete account */
export async function deleteAccount(req: Request, res: Response): Promise<void> {
  const userId = req.session.userId as number;
  await userService.deleteAccount(userId);
  req.session.destroy(() => {
    res.clearCookie(config.session.name);
    res.redirect('/');
  });
}
