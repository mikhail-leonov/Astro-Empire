import bcrypt from 'bcryptjs';
import * as users from '../models/userModel';
import type { UserRow, UserWithTierRow } from '../models/userModel';
import { query, execute, insert, affected } from '../db';
import type { PublicUser, AccountTier } from '../types/types';

const SALT_ROUNDS = 12;

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

export type RegisterResult =
  | { ok: true; userId: number; role: string }
  | { ok: false; field: 'username' | 'email'; error: string };

export type AuthResult =
  | { ok: true; user: PublicUser }
  | { ok: false };

function toPublic(row: UserWithTierRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    tierId: row.tier_id,
    tierName: row.tier_name,
    created_at: row.created_at,
    last_seen: row.last_seen,
  };
}

/** Create a new account (default role 'user', default tier 'Free'). */
export async function register(input: RegisterInput): Promise<RegisterResult> {
  if (await users.findByUsername(input.username)) {
    return { ok: false, field: 'username', error: 'That username is already taken.' };
  }
  if (await users.findByEmail(input.email)) {
    return { ok: false, field: 'email', error: 'An account with that email already exists.' };
  }

  const hash = await bcrypt.hash(input.password, SALT_ROUNDS);

  try {
    const userId = await users.createUser(input.username, input.email, hash);
    return { ok: true, userId, role: 'user' };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && (err as { code?: string }).code === users.ER_DUP_ENTRY) {
      const message = String((err as { message?: string }).message ?? '');
      const field: 'username' | 'email' = message.includes('email') ? 'email' : 'username';
      return {
        ok: false,
        field,
        error: field === 'email'
          ? 'An account with that email already exists.'
          : 'That username is already taken.',
      };
    }
    throw err;
  }
}

/** Verify credentials. `identifier` may be a username or an email. */
export async function authenticate(identifier: string, password: string): Promise<AuthResult> {
  const row = await users.findByIdentifier(identifier);
  if (!row) {
    await bcrypt.compare(password, '$2a$12$0000000000000000000000000000000000000000000000000000');
    return { ok: false };
  }

  const match = await bcrypt.compare(password, row.password_hash);
  if (!match) return { ok: false };

  await users.touchLastSeen(row.id);
  const withTier = await users.findByIdWithTier(row.id);
  if (!withTier) return { ok: false };
  return { ok: true, user: toPublic(withTier) };
}

export async function getProfile(id: number): Promise<PublicUser | null> {
  const row = await users.findByIdWithTier(id);
  return row ? toPublic(row) : null;
}

export async function deleteAccount(id: number): Promise<boolean> {
  return users.deleteById(id);
}

/* ---------------------------------------------------------- admin: user CRUD */
export async function adminListUsers(): Promise<PublicUser[]> {
  const rows = await users.listAllWithTier();
  return rows.map(toPublic);
}

export async function adminUpdateUser(id: number, fields: { username?: string; email?: string; tierId?: number; role?: 'user' | 'admin' }): Promise<void> {
  const current = await users.findById(id);
  if (!current) throw new Error('User not found');
  if (fields.username !== undefined || fields.email !== undefined) {
    await users.updateProfile(id, fields.username ?? current.username, fields.email ?? current.email);
  }
  if (fields.tierId !== undefined) await users.updateTier(id, fields.tierId);
  if (fields.role !== undefined) await users.updateRole(id, fields.role);
}

export async function adminDeleteUser(id: number): Promise<boolean> {
  return users.deleteById(id);
}

/* ---------------------------------------------------------- admin: tier CRUD */
function toTier(row: any): AccountTier {
  return {
    id: row.id, code: row.code, name: row.name,
    maxBases: row.max_bases, maxQueue: row.max_queue,
    description: row.description, sortOrder: row.sort_order,
  };
}

export async function listTiers(): Promise<AccountTier[]> {
  const rows = await query<any>('SELECT * FROM account_tiers ORDER BY sort_order, id');
  return rows.map(toTier);
}

export async function createTier(input: { code: string; name: string; maxBases: number; maxQueue: number; description: string; sortOrder: number }): Promise<number> {
  return insert(
    'INSERT INTO account_tiers (code, name, max_bases, max_queue, description, sort_order) VALUES (?,?,?,?,?,?)',
    [input.code, input.name, input.maxBases, input.maxQueue, input.description, input.sortOrder],
  );
}

export async function updateTierRow(id: number, input: { code: string; name: string; maxBases: number; maxQueue: number; description: string; sortOrder: number }): Promise<void> {
  await execute(
    'UPDATE account_tiers SET code=?, name=?, max_bases=?, max_queue=?, description=?, sort_order=? WHERE id=?',
    [input.code, input.name, input.maxBases, input.maxQueue, input.description, input.sortOrder, id],
  );
}

export async function deleteTier(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  if (id === 1) return { ok: false, error: 'The default Free tier cannot be deleted.' };
  const inUse = await query<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE tier_id = ?', [id]);
  if ((inUse[0]?.n ?? 0) > 0) return { ok: false, error: 'Reassign the accounts on this tier before deleting it.' };
  const removed = await affected('DELETE FROM account_tiers WHERE id = ?', [id]);
  return removed > 0 ? { ok: true } : { ok: false, error: 'Tier not found' };
}
