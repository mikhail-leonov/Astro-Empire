// Lazy MySQL access. The pool and the `mysql2` driver are only loaded the
// first time a galaxy API endpoint is hit, so the server still boots fine if
// `mysql2` isn't installed or no database is configured — the client simply
// falls back to its local generator in that case.
//
// Install the driver once:  npm install mysql2
import { config } from '../config';

// `mysql2/promise` typings aren't imported statically (the dep is optional),
// so we keep the pool loosely typed.
let poolPromise: Promise<any> | null = null;

async function getPool(): Promise<any> {
  if (!poolPromise) {
    poolPromise = (async () => {
      const mysql = await import('mysql2/promise');
      return mysql.createPool({
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.name,
        waitForConnections: true,
        connectionLimit: 10,
        maxIdle: 10,
        queueLimit: 0,
        charset: 'utf8mb4',
      });
    })();
  }
  return poolPromise;
}

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const pool = await getPool();
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

export async function execute(sql: string, params?: any[]): Promise<void> {
  const pool = await getPool();
  await pool.query(sql, params);
}

// Insert many rows in chunks using a single multi-row INSERT per chunk.
export async function bulkInsert(
  table: string,
  columns: string[],
  rows: any[][],
  chunkSize = 500,
): Promise<void> {
  if (!rows.length) return;
  const pool = await getPool();
  const colSql = columns.map((c) => '`' + c + '`').join(', ');
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders = chunk
      .map(() => '(' + columns.map(() => '?').join(', ') + ')')
      .join(', ');
    const flat: any[] = [];
    chunk.forEach((r) => r.forEach((v) => flat.push(v)));
    await pool.query(
      'INSERT INTO `' + table + '` (' + colSql + ') VALUES ' + placeholders,
      flat,
    );
  }
}

export async function ping(): Promise<boolean> {
  try {
    const pool = await getPool();
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    return true;
  } catch {
    return false;
  }
}
