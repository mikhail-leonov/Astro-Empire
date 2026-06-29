import mysql, { type Pool } from 'mysql2/promise';

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
}

/** DDL used by the first-run setup wizard (kept in sync with src/sql/schema.sql). */
const USERS_DDL = `
CREATE TABLE IF NOT EXISTS users (
    id            INT PRIMARY KEY AUTO_INCREMENT,
    username      VARCHAR(32)  NOT NULL UNIQUE,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_email (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci`;

const SESSIONS_DDL = `
CREATE TABLE IF NOT EXISTS sessions (
    session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
    expires    INT UNSIGNED NOT NULL,
    data       MEDIUMTEXT COLLATE utf8mb4_bin,
    PRIMARY KEY (session_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4`;

let pool: Pool | null = null;
let ready = false;

/** (Re)create the active connection pool from a config. Does not connect yet. */
export function init(cfg: DbConfig): void {
  pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: cfg.connectionLimit,
    charset: 'utf8mb4',
  });
}

export function getPool(): Pool {
  if (!pool) throw new Error('Database pool is not initialised. Complete setup first.');
  return pool;
}

export function isReady(): boolean {
  return ready;
}

/** Ping the active pool; updates and returns readiness. */
export async function healthCheck(): Promise<boolean> {
  if (!pool) {
    ready = false;
    return false;
  }
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    ready = true;
  } catch {
    ready = false;
  }
  return ready;
}

/** Tear down the active pool. */
export async function reset(): Promise<void> {
  if (pool) {
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
  }
  pool = null;
  ready = false;
}

function quoteIdent(name: string): string {
  return '`' + name.replace(/`/g, '') + '`';
}

/**
 * Used by the setup wizard: validate the server credentials, create the
 * database if missing, and ensure the required tables exist.
 */
export async function ensureDatabase(
  cfg: DbConfig
): Promise<{ ok: true } | { ok: false; error: string }> {
  let admin: Pool | null = null;
  try {
    // Connect WITHOUT selecting a database so we can create it if needed.
    admin = mysql.createPool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      connectionLimit: 1,
      charset: 'utf8mb4',
      multipleStatements: false,
    });
    const conn = await admin.getConnection();
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS ${quoteIdent(cfg.database)} ` +
        `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await conn.query(`USE ${quoteIdent(cfg.database)}`);
    await conn.query(USERS_DDL);
    await conn.query(SESSIONS_DDL);
    conn.release();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    if (admin) {
      try {
        await admin.end();
      } catch {
        /* ignore */
      }
    }
  }
}
