import bcrypt from 'bcryptjs';
import * as users from '../models/userModel';
import type { UserRow } from '../models/userModel';
import type { PublicUser } from '../types/types';

const SALT_ROUNDS = 12;

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
}

export type RegisterResult =
  | { ok: true; userId: number }
  | { ok: false; field: 'username' | 'email'; error: string };

export type AuthResult =
  | { ok: true; user: PublicUser }
  | { ok: false };

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    created_at: row.created_at,
    last_seen: row.last_seen,
  };
}

/** Create a new account. Returns a friendly result rather than throwing on conflicts. */
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
    return { ok: true, userId };
  } catch (err: unknown) {
    // Race condition: someone registered the same value between the checks above.
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
    // Hash a dummy value to keep timing roughly constant for unknown users.
    await bcrypt.compare(password, '$2a$12$0000000000000000000000000000000000000000000000000000');
    return { ok: false };
  }

  const match = await bcrypt.compare(password, row.password_hash);
  if (!match) return { ok: false };

  await users.touchLastSeen(row.id);
  return { ok: true, user: toPublic(row) };
}

export async function getProfile(id: number): Promise<PublicUser | null> {
  const row = await users.findById(id);
  return row ? toPublic(row) : null;
}

export async function deleteAccount(id: number): Promise<boolean> {
  return users.deleteById(id);
}
