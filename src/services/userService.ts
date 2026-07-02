import bcrypt from 'bcryptjs';
import * as userModel from '../models/userModel';
import { query, execute, insert, affected } from '../db';

const SALT_ROUNDS = 12;

export interface PublicProfile {
  id: number; username: string; email: string; role: string;
  tierName: string; createdAt: Date; lastSeen: Date;
}

type RegisterResult =
  | { ok: true; userId: number; role: string }
  | { ok: false; field: 'username' | 'email'; error: string };

export async function register(input: { username: string; email: string; password: string }): Promise<RegisterResult> {
  const existingName = await userModel.findByUsername(input.username);
  if (existingName) return { ok: false, field: 'username', error: 'That username is already taken.' };
  const existingEmail = await userModel.findByEmail(input.email);
  if (existingEmail) return { ok: false, field: 'email', error: 'An account already uses that email.' };

  const hash = await bcrypt.hash(input.password, SALT_ROUNDS);
  try {
    const userId = await userModel.createUser(input.username, input.email, hash);
    return { ok: true, userId, role: 'user' };
  } catch (e: any) {
    if (e && e.code === userModel.ER_DUP_ENTRY) {
      return { ok: false, field: 'username', error: 'That username or email is already registered.' };
    }
    throw e;
  }
}

type AuthResult =
  | { ok: true; user: { id: number; username: string; role: string } }
  | { ok: false };

export async function authenticate(identifier: string, password: string): Promise<AuthResult> {
  const user = await userModel.findByIdentifier(identifier);
  if (!user) return { ok: false };
  const good = await bcrypt.compare(password, user.password_hash);
  if (!good) return { ok: false };
  await userModel.touchLastSeen(user.id);
  return { ok: true, user: { id: user.id, username: user.username, role: user.role } };
}

export async function getProfile(userId: number): Promise<PublicProfile | null> {
  const row = await userModel.findByIdWithTier(userId);
  if (!row) return null;
  return {
    id: row.id, username: row.username, email: row.email, role: row.role,
    tierName: row.tier_name, createdAt: row.created_at, lastSeen: row.last_seen,
  };
}

export async function deleteAccount(userId: number): Promise<void> {
  await userModel.deleteById(userId);
}

/* ---------------------------------------------------------- admin */
export async function adminListUsers() {
  return userModel.listAllWithTier();
}

export async function adminUpdateUser(id: number, fields: { username: string; email: string; tierId: number; role: 'user' | 'admin' }): Promise<void> {
  await userModel.updateProfile(id, fields.username, fields.email);
  await userModel.updateTier(id, fields.tierId);
  await userModel.updateRole(id, fields.role);
}

export async function adminDeleteUser(id: number): Promise<void> {
  await userModel.deleteById(id);
}

/* ---------------------------------------------------------- account tiers */
export interface TierRow {
  id: number; code: string; name: string; description: string;
  max_bases: number; max_queue: number; sort_order: number;
}
export async function listTiers(): Promise<TierRow[]> {
  return query<TierRow>('SELECT * FROM account_tiers ORDER BY sort_order, id');
}
export async function createTier(fields: { code: string; name: string; maxBases: number; maxQueue: number; description: string; sortOrder: number }): Promise<number> {
  return insert(
    'INSERT INTO account_tiers (code, name, description, max_bases, max_queue, sort_order) VALUES (?,?,?,?,?,?)',
    [fields.code, fields.name, fields.description, fields.maxBases, fields.maxQueue, fields.sortOrder],
  );
}
export async function updateTierRow(id: number, fields: { code: string; name: string; maxBases: number; maxQueue: number; description: string; sortOrder: number }): Promise<void> {
  await execute(
    'UPDATE account_tiers SET code=?, name=?, description=?, max_bases=?, max_queue=?, sort_order=? WHERE id=?',
    [fields.code, fields.name, fields.description, fields.maxBases, fields.maxQueue, fields.sortOrder, id],
  );
}
export async function deleteTier(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const inUse = await query<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE tier_id = ?', [id]);
  if ((inUse[0]?.n ?? 0) > 0) return { ok: false, error: 'Cannot delete a tier that accounts are currently using.' };
  const removed = await affected('DELETE FROM account_tiers WHERE id = ?', [id]);
  return removed > 0 ? { ok: true } : { ok: false, error: 'Tier not found.' };
}
