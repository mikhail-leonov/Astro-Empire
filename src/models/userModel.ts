import { query, insert, affected, execute } from '../db';

export interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  role: string;
  tier_id: number;
  created_at: Date;
  last_seen: Date;
}

export interface UserWithTierRow extends UserRow {
  tier_name: string;
}

/** MySQL duplicate-key error code. */
export const ER_DUP_ENTRY = 'ER_DUP_ENTRY';

export async function findById(id: number): Promise<UserRow | null> {
  const rows = await query<UserRow>('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] ?? null;
}

export async function findByIdWithTier(id: number): Promise<UserWithTierRow | null> {
  const rows = await query<UserWithTierRow>(
    'SELECT u.*, t.name AS tier_name FROM users u JOIN account_tiers t ON t.id = u.tier_id WHERE u.id = ? LIMIT 1',
    [id],
  );
  return rows[0] ?? null;
}

export async function findByUsername(username: string): Promise<UserRow | null> {
  const rows = await query<UserRow>('SELECT * FROM users WHERE username = ? LIMIT 1', [username]);
  return rows[0] ?? null;
}

export async function findByEmail(email: string): Promise<UserRow | null> {
  const rows = await query<UserRow>('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  return rows[0] ?? null;
}

/** Look up by username OR email (used at login). */
export async function findByIdentifier(identifier: string): Promise<UserRow | null> {
  const rows = await query<UserRow>(
    'SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1',
    [identifier, identifier]
  );
  return rows[0] ?? null;
}

export async function createUser(
  username: string,
  email: string,
  passwordHash: string,
): Promise<number> {
  return insert('INSERT INTO users (username, email, password_hash, role, tier_id) VALUES (?, ?, ?, \'user\', 1)', [
    username, email, passwordHash,
  ]);
}

export async function deleteById(id: number): Promise<boolean> {
  return (await affected('DELETE FROM users WHERE id = ?', [id])) > 0;
}

export async function touchLastSeen(id: number): Promise<void> {
  await execute('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [id]);
}

/* ---------------------------------------------------------- admin: CRUD */
export async function listAllWithTier(): Promise<UserWithTierRow[]> {
  return query<UserWithTierRow>(
    'SELECT u.*, t.name AS tier_name FROM users u JOIN account_tiers t ON t.id = u.tier_id ORDER BY u.id',
  );
}

export async function updateProfile(id: number, username: string, email: string): Promise<void> {
  await execute('UPDATE users SET username = ?, email = ? WHERE id = ?', [username, email, id]);
}

export async function updateTier(id: number, tierId: number): Promise<void> {
  await execute('UPDATE users SET tier_id = ? WHERE id = ?', [tierId, id]);
}

export async function updateRole(id: number, role: 'user' | 'admin'): Promise<void> {
  await execute('UPDATE users SET role = ? WHERE id = ?', [role, id]);
}
