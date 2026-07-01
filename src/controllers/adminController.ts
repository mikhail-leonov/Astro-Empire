import type { Request, Response } from 'express';
import * as userService from '../services/userService';
import { addFlash } from '../utils/flash';

/* ---------------------------------------------------------- GET /admin */
export async function showAdmin(_req: Request, res: Response): Promise<void> {
  const [accounts, tiers] = await Promise.all([userService.adminListUsers(), userService.listTiers()]);
  res.render('admin', { title: 'Admin · Accounts', accounts, tiers, errors: {} });
}

/* ---------------------------------------------------------- user CRUD */
export async function updateUser(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim();
  const tierId = Number(req.body.tierId);
  const role = req.body.role === 'admin' ? 'admin' : 'user';

  try {
    await userService.adminUpdateUser(id, { username, email, tierId, role });
    addFlash(req, 'success', `Account #${id} updated.`);
  } catch (e) {
    addFlash(req, 'error', `Could not update account #${id}: ${(e as Error).message}`);
  }
  res.redirect('/admin');
}

export async function deleteUser(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (id === req.session.userId) {
    addFlash(req, 'error', "You can't delete the account you're logged in as.");
    res.redirect('/admin');
    return;
  }
  await userService.adminDeleteUser(id);
  addFlash(req, 'success', `Account #${id} deleted.`);
  res.redirect('/admin');
}

/* ---------------------------------------------------------- tier CRUD */
export async function createTier(req: Request, res: Response): Promise<void> {
  const { code, name, description } = req.body;
  const maxBases = Number(req.body.maxBases) || 1;
  const maxQueue = Number(req.body.maxQueue) || 1;
  const sortOrder = Number(req.body.sortOrder) || 0;
  try {
    await userService.createTier({ code: String(code).trim(), name: String(name).trim(), maxBases, maxQueue, description: String(description || ''), sortOrder });
    addFlash(req, 'success', `Tier "${name}" created.`);
  } catch (e) {
    addFlash(req, 'error', `Could not create tier: ${(e as Error).message}`);
  }
  res.redirect('/admin');
}

export async function updateTier(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const { code, name, description } = req.body;
  const maxBases = Number(req.body.maxBases) || 1;
  const maxQueue = Number(req.body.maxQueue) || 1;
  const sortOrder = Number(req.body.sortOrder) || 0;
  try {
    await userService.updateTierRow(id, { code: String(code).trim(), name: String(name).trim(), maxBases, maxQueue, description: String(description || ''), sortOrder });
    addFlash(req, 'success', `Tier "${name}" updated.`);
  } catch (e) {
    addFlash(req, 'error', `Could not update tier: ${(e as Error).message}`);
  }
  res.redirect('/admin');
}

export async function deleteTier(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const result = await userService.deleteTier(id);
  if (result.ok) addFlash(req, 'success', `Tier #${id} deleted.`);
  else addFlash(req, 'error', result.error);
  res.redirect('/admin');
}
