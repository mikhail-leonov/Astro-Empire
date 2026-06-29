import session, { type SessionData, type Store } from 'express-session';
import type { DbConfig } from '../db';

// express-mysql-session has no bundled types.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MySQLStore = require('express-mysql-session')(session);

/**
 * A session store that delegates to an underlying store which can be swapped
 * at runtime. Before the database is configured it uses an in-memory store
 * (so the setup wizard's session/CSRF works); afterwards it is swapped for the
 * MySQL-backed store — no restart required.
 */
class LazyStore extends session.Store {
  private current: Store = new session.MemoryStore();

  setStore(store: Store): void {
    this.current = store;
  }

  get(sid: string, callback: (err: unknown, session?: SessionData | null) => void): void {
    this.current.get(sid, callback);
  }

  set(sid: string, sess: SessionData, callback?: (err?: unknown) => void): void {
    this.current.set(sid, sess, callback);
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    this.current.destroy(sid, callback);
  }

  touch(sid: string, sess: SessionData, callback?: () => void): void {
    if (typeof this.current.touch === 'function') {
      this.current.touch(sid, sess, callback);
    } else if (callback) {
      callback();
    }
  }

  all(
    callback: (
      err: unknown,
      obj?: SessionData[] | { [sid: string]: SessionData } | null
    ) => void
  ): void {
    if (typeof this.current.all === 'function') this.current.all(callback);
    else callback(null, []);
  }

  length(callback: (err: unknown, length?: number) => void): void {
    if (typeof this.current.length === 'function') this.current.length(callback);
    else callback(null, 0);
  }

  clear(callback?: (err?: unknown) => void): void {
    if (typeof this.current.clear === 'function') this.current.clear(callback);
    else if (callback) callback();
  }
}

export const lazyStore = new LazyStore();

/** Swap the active store to a MySQL-backed one using the given DB config. */
export function attachMySQLStore(cfg: DbConfig): void {
  const store = new MySQLStore({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    createDatabaseTable: true,
    schema: {
      tableName: 'sessions',
      columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' },
    },
  });
  lazyStore.setStore(store);
}
