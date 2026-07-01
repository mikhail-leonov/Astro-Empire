// MySQL access for every piece of live game state: commanders (players),
// local-galaxy systems/planets, bases, garrisoned & in-transit fleets/ships,
// the research queue, the event log, and the procedural Galaxy-Gen tables.
// Nothing gameplay-relevant is kept only in the browser — this module is the
// single gateway to the DB for the rest of the server.
//
// The pool is created lazily: either explicitly via init(cfg) (the /setup
// wizard does this after verifying a connection), or automatically from
// config.db the first time a query runs, if DB_HOST/.env was already filled
// in on a previous run. Install the driver once: npm install mysql2
import fs from 'fs';
import path from 'path';
import { config } from '../config';

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
}

// `mysql2/promise` typings aren't imported statically (the dep is optional),
// so the pool and connections are kept loosely typed.
let pool: any = null;
let activeConfig: DbConfig | null = null;

function cfgFromAppConfig(): DbConfig | null {
  const c = config.db;
  if (!c.host || !c.user || !c.database) return null;
  return {
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: c.database,
    connectionLimit: c.connectionLimit,
  };
}

/** True once a DB configuration is known (env on boot, or a completed /setup). */
export function isReady(): boolean {
  return !!(pool || cfgFromAppConfig());
}

/** Explicitly (re)configure the live pool, e.g. right after /setup succeeds. */
export function init(cfg: DbConfig): void {
  activeConfig = cfg;
  pool = null; // rebuilt lazily on next getPool()
}

/** Drop the current pool so the next query rebuilds it from the latest config. */
export async function reset(): Promise<void> {
  if (pool) {
    try { await pool.end(); } catch { /* ignore */ }
  }
  pool = null;
  activeConfig = null;
}

async function getPool(): Promise<any> {
  if (pool) return pool;
  const cfg = activeConfig || cfgFromAppConfig();
  if (!cfg) {
    throw new Error('Database is not configured yet. Visit /setup first.');
  }
  const mysql = await import('mysql2/promise');
  pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: cfg.connectionLimit || 10,
    maxIdle: cfg.connectionLimit || 10,
    queueLimit: 0,
    charset: 'utf8mb4',
  });
  return pool;
}

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const p = await getPool();
  const [rows] = await p.query(sql, params);
  return rows as T[];
}

export async function execute(sql: string, params?: any[]): Promise<void> {
  const p = await getPool();
  await p.query(sql, params);
}

/** Run an INSERT and return its auto-increment id (same connection, so LAST_INSERT_ID() is accurate). */
export async function insert(sql: string, params?: any[]): Promise<number> {
  const p = await getPool();
  const [result] = await p.query(sql, params);
  return (result as any).insertId as number;
}

/** Run an UPDATE/DELETE and return the number of affected rows. */
export async function affected(sql: string, params?: any[]): Promise<number> {
  const p = await getPool();
  const [result] = await p.query(sql, params);
  return (result as any).affectedRows as number;
}

// Insert many rows in chunks using a single multi-row INSERT per chunk.
export async function bulkInsert(
  table: string,
  columns: string[],
  rows: any[][],
  chunkSize = 500,
): Promise<void> {
  if (!rows.length) return;
  const p = await getPool();
  const colSql = columns.map((c) => '`' + c + '`').join(', ');
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders = chunk
      .map(() => '(' + columns.map(() => '?').join(', ') + ')')
      .join(', ');
    const flat: any[] = [];
    chunk.forEach((r) => r.forEach((v) => flat.push(v)));
    await p.query(
      'INSERT INTO `' + table + '` (' + colSql + ') VALUES ' + placeholders,
      flat,
    );
  }
}

export async function ping(): Promise<boolean> {
  try {
    const p = await getPool();
    const conn = await p.getConnection();
    await conn.ping();
    conn.release();
    return true;
  } catch {
    return false;
  }
}

/** Quick liveness check used by the /setup wizard after connecting. */
export async function healthCheck(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the target database if missing, then run schema.sql and galaxy.sql
 * against it (with the hardcoded `astro_empire` name swapped for whatever
 * database name the user chose in /setup) so every game table — players,
 * systems, planets, bases, fleets, research_queue, logs, gx_systems,
 * gx_astros, gx_claims — exists before the app is used.
 */
export async function ensureDatabase(cfg: DbConfig): Promise<{ ok: true } | { ok: false; error: string }> {
  const mysql = await import('mysql2/promise');
  let conn: any;
  try {
    conn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      multipleStatements: true,
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS `' + cfg.database.replace(/`/g, '') + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await conn.query('USE `' + cfg.database.replace(/`/g, '') + '`');

    const schemaPath = path.join(process.cwd(), 'src', 'sql', 'schema.sql');
    const galaxyPath = path.join(process.cwd(), 'src', 'sql', 'galaxy.sql');
    const rename = (sql: string) => sql
      .replace(/CREATE DATABASE IF NOT EXISTS astro_empire[^;]*;/i, '')
      .replace(/USE astro_empire;/gi, '')
      .replace(/astro_empire/g, cfg.database);

    if (fs.existsSync(schemaPath)) {
      await conn.query(rename(fs.readFileSync(schemaPath, 'utf8')));
    }
    if (fs.existsSync(galaxyPath)) {
      await conn.query(rename(fs.readFileSync(galaxyPath, 'utf8')));
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    try { await conn.end(); } catch { /* ignore */ }
  }
}
