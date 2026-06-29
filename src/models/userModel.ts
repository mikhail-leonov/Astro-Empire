import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { getPool } from '../db';

export interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  created_at: Date;
  last_seen: Date;
}

/** MySQL duplicate-key error code. */
export const ER_DUP_ENTRY = 'ER_DUP_ENTRY';

export async function findById(id: number): Promise<UserRow | null> {
  const [rows] = await getPool().query<UserRow[]>(
    'SELECT * FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0] ?? null;
}

export async function findByUsername(username: string): Promise<UserRow | null> {
  const [rows] = await getPool().query<UserRow[]>(
    'SELECT * FROM users WHERE username = ? LIMIT 1',
    [username]
  );
  return rows[0] ?? null;
}

export async function findByEmail(email: string): Promise<UserRow | null> {
  const [rows] = await getPool().query<UserRow[]>(
    'SELECT * FROM users WHERE email = ? LIMIT 1',
    [email]
  );
  return rows[0] ?? null;
}

/** Look up by username OR email (used at login). */
export async function findByIdentifier(identifier: string): Promise<UserRow | null> {
  const [rows] = await getPool().query<UserRow[]>(
    'SELECT * FROM users WHERE username = ? OR email = ? LIMIT 1',
    [identifier, identifier]
  );
  return rows[0] ?? null;
}

export async function createUser(
  username: string,
  email: string,
  passwordHash: string
): Promise<number> {
  const [result] = await getPool().execute<ResultSetHeader>(
    'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
    [username, email, passwordHash]
  );
  return result.insertId;
}

export async function deleteById(id: number): Promise<boolean> {
  const [result] = await getPool().execute<ResultSetHeader>(
    'DELETE FROM users WHERE id = ?',
    [id]
  );
  return result.affectedRows > 0;
}

export async function touchLastSeen(id: number): Promise<void> {
  await getPool().execute('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [id]);
}
