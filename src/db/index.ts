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

// FIX: previously isReady() only checked whether DB_HOST/USER/DATABASE were
// *present* in config, never whether they actually work. If those values
// were wrong (bad password, DB user deleted, etc.), isReady() still
// returned true, which (a) let every request past the "redirect to /setup"
// middleware in src/index.ts straight into DB queries that then threw
// ER_ACCESS_DENIED_ERROR, and (b) made showSetup() itself immediately
// redirect back to '/' before the person could even reach the form to fix
// their credentials — a dead end with no way back in short of manually
// editing .env. `lastError` now records the most recent known connection
// failure (set by the boot-time check in src/index.ts, and cleared/set by
// /setup); isReady() treats a config with a known failure as not ready.
let lastError: string | null = null;

export function setLastError(err: string | null): void {
  lastError = err;
}
export function getLastError(): string | null {
  return lastError;
}

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

/** True once a DB configuration is known AND isn't flagged as currently broken. */
export function isReady(): boolean {
  if (pool || activeConfig) return true;
  return !!cfgFromAppConfig() && !lastError;
}

/** Explicitly (re)configure the live pool, e.g. right after /setup succeeds. */
export function init(cfg: DbConfig): void {
  activeConfig = cfg;
  pool = null; // rebuilt lazily on next getPool()
  lastError = null;
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
 * Bump this whenever schema.sql changes in a way that isn't safely
 * idempotent against existing data (a new NOT NULL column with no default,
 * a changed column type, a renamed/removed table, etc.). ensureDatabase()
 * below compares this against the version recorded in the target database's
 * own `schema_meta` table and rebuilds automatically when they don't match.
 * Purely additive changes (a new `CREATE TABLE IF NOT EXISTS`) don't strictly
 * require a bump, but bumping is always safe.
 */
export const SCHEMA_VERSION = 1;

interface SchemaCheck {
  exists: boolean;
  version: number; // 0 = database exists but predates schema_meta / is empty
}

/** Look up whether `database` exists on this server and, if so, its recorded schema version. */
async function checkSchema(conn: any, database: string): Promise<SchemaCheck> {
  const [rows] = await conn.query(
    'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
    [database],
  );
  if (!rows.length) return { exists: false, version: 0 };

  await conn.query('USE `' + database + '`');
  try {
    const [verRows] = await conn.query('SELECT version FROM schema_meta ORDER BY id DESC LIMIT 1');
    return { exists: true, version: verRows[0] ? Number(verRows[0].version) : 0 };
  } catch {
    // schema_meta itself doesn't exist yet — either a pre-versioning install,
    // or a database created by something other than this app.
    return { exists: true, version: 0 };
  }
}

/** Read + lightly rewrite schema.sql / galaxy.sql, then execute against the already-selected database. */
async function applySchemaFiles(conn: any, database: string): Promise<void> {
  const schemaPath = path.join(process.cwd(), 'src', 'sql', 'schema.sql');
  const galaxyPath = path.join(process.cwd(), 'src', 'sql', 'galaxy.sql');
  // Placeholder token used inside schema.sql/galaxy.sql wherever the
  // database name might need to be referenced explicitly (there currently
  // is no such reference — every statement is unqualified and runs against
  // whatever database the `USE` above selected — but the substitution is
  // kept so future qualified references stay portable across install names).
  const rename = (sql: string) => sql
    .replace(/CREATE DATABASE IF NOT EXISTS astro_empire[^;]*;/gi, '')
    .replace(/DROP DATABASE IF EXISTS astro_empire[^;]*;/gi, '')
    .replace(/USE astro_empire;/gi, '')
    .replace(/astro_empire/g, database);

  if (fs.existsSync(schemaPath)) {
    await conn.query(rename(fs.readFileSync(schemaPath, 'utf8')));
  }
  if (fs.existsSync(galaxyPath)) {
    await conn.query(rename(fs.readFileSync(galaxyPath, 'utf8')));
  }
  await conn.query(
    'INSERT INTO schema_meta (id, version, applied_at) VALUES (1, ?, CURRENT_TIMESTAMP) ' +
    'ON DUPLICATE KEY UPDATE version = VALUES(version), applied_at = VALUES(applied_at)',
    [SCHEMA_VERSION],
  );
}

/**
 * Best-effort check for whether `cfg` points at a database that already has
 * real accounts in it. Used to decide whether GET /reset (see
 * src/controllers/resetController.ts) may run without an admin session: an
 * empty or not-yet-existing database has nothing worth protecting, but one
 * with real registered commanders must not be droppable by an anonymous
 * visit to a URL. Any failure (can't connect, database/table doesn't exist)
 * is treated as "no users" — i.e. safe to reset — rather than blocking the
 * bootstrap/recovery case this endpoint exists for.
 */
export async function hasExistingUsers(cfg: DbConfig): Promise<boolean> {
  const mysql = await import('mysql2/promise');
  const database = cfg.database.replace(/`/g, '');
  let conn: any;
  try {
    conn = await mysql.createConnection({
      host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password,
    });
  } catch {
    return false;
  }
  try {
    const [dbRows] = await conn.query(
      'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database],
    );
    if (!dbRows.length) return false;
    await conn.query('USE `' + database + '`');
    const [countRows] = await conn.query('SELECT COUNT(*) AS n FROM users');
    return (countRows[0]?.n ?? 0) > 0;
  } catch {
    return false; // no `users` table yet, or some other transient failure
  } finally {
    try { await conn.end(); } catch { /* ignore */ }
  }
}

/**
 * Unconditionally DROPs and recreates `cfg.database` from the latest
 * schema.sql (and galaxy.sql, if present), then applies src/sql/seed.sql
 * too if that file exists on disk. Unlike ensureDatabase(), this runs
 * regardless of the database's current schema_meta version — it's the
 * backing implementation for GET /reset, an explicit "start over" action,
 * not the boot-time drift check.
 */
export async function forceRebuildDatabase(cfg: DbConfig): Promise<{ ok: true; seeded: boolean } | { ok: false; error: string }> {
  const mysql = await import('mysql2/promise');
  const database = cfg.database.replace(/`/g, '');
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
    await conn.query('DROP DATABASE IF EXISTS `' + database + '`');
    await conn.query('CREATE DATABASE `' + database + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    await conn.query('USE `' + database + '`');
    await applySchemaFiles(conn, database);

    const seedPath = path.join(process.cwd(), 'src', 'sql', 'seed.sql');
    let seeded = false;
    if (fs.existsSync(seedPath)) {
      await conn.query(fs.readFileSync(seedPath, 'utf8'));
      seeded = true;
    }
    return { ok: true, seeded };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    try { await conn.end(); } catch { /* ignore */ }
  }
}

/**
 * Ensures the target database exists, is on the current schema version, and
 * has every game table — players, systems, planets, bases, fleets,
 * research_queue, logs, gx_systems, gx_astros, gx_claims, schema_meta —
 * before the app is used.
 *
 *  - Database missing entirely  → silently created fresh from schema.sql.
 *  - Database exists, recorded schema_meta.version < SCHEMA_VERSION (or the
 *    schema_meta table itself is missing, meaning an install that predates
 *    versioning) → the whole database is DROPPED and recreated fresh from
 *    the latest schema.sql. This is a deliberate, destructive migration
 *    strategy: Astro Empire has no incremental migration files, so an
 *    out-of-date structure is discarded rather than patched in place.
 *  - Database exists and is already current                → left untouched.
 *
 * FIX (was broken): schema.sql used to hardcode `DROP DATABASE IF EXISTS ae`,
 * `CREATE DATABASE ae`, and `GRANT ... FLUSH PRIVILEGES`, none of which
 * referenced the placeholder token this function rewrites — so every fresh
 * install actually created its tables inside a database literally named
 * "ae" (and could silently DROP a pre-existing "ae" database), while the
 * app's own pool connected to whatever name the user typed in /setup, which
 * stayed empty. schema.sql no longer contains any CREATE/DROP DATABASE or
 * GRANT statements — this function is the only place that creates (or
 * drops) the database, and it always targets the real `cfg.database` name.
 */
export async function ensureDatabase(cfg: DbConfig): Promise<{ ok: true; rebuilt: boolean } | { ok: false; error: string }> {
  const mysql = await import('mysql2/promise');
  const database = cfg.database.replace(/`/g, '');
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
    const check = await checkSchema(conn, database);
    const outOfDate = check.exists && check.version < SCHEMA_VERSION;

    if (outOfDate) {
      // Existing database predates the current schema — rebuilt from
      // scratch rather than migrated in place (no per-version migration
      // scripts exist). This deletes all data in it; there is no "keep the
      // old rows" path here by design.
      await conn.query('DROP DATABASE `' + database + '`');
    }

    if (!check.exists || outOfDate) {
      await conn.query('CREATE DATABASE `' + database + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
      await conn.query('USE `' + database + '`');
      await applySchemaFiles(conn, database);
      return { ok: true, rebuilt: true };
    }

    // Already exists and is current — nothing to do. (schema.sql's
    // `CREATE TABLE IF NOT EXISTS` statements are not re-run here on
    // purpose: doing so on every boot is harmless for tables but would
    // silently re-run the account_tiers seed INSERT's ON DUPLICATE KEY
    // branch every time, which is unnecessary work with no benefit.)
    return { ok: true, rebuilt: false };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    try { await conn.end(); } catch { /* ignore */ }
  }
}
