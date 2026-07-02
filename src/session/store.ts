import session from 'express-session';
import type { DbConfig } from '../db';

/**
 * A session.Store that does nothing until a real MySQL-backed store is
 * attached (via attachMySQLStore, called right after /setup succeeds).
 * Before that point sessions are simply not persisted across restarts —
 * acceptable during first-run setup, since there's no DB to store them in
 * yet anyway.
 */
class LazyStore extends session.Store {
  private real: session.Store | null = null;
  private memoryFallback = new session.MemoryStore();

  attach(store: session.Store): void {
    this.real = store;
  }

  private target(): session.Store {
    return this.real || this.memoryFallback;
  }

  get(sid: string, cb: (err: any, session?: session.SessionData | null) => void): void {
    this.target().get(sid, cb);
  }
  set(sid: string, sessionData: session.SessionData, cb?: (err?: any) => void): void {
    this.target().set(sid, sessionData, cb);
  }
  destroy(sid: string, cb?: (err?: any) => void): void {
    this.target().destroy(sid, cb);
  }
  touch(sid: string, sessionData: session.SessionData, cb?: () => void): void {
    const t = this.target() as any;
    if (typeof t.touch === 'function') t.touch(sid, sessionData, cb);
    else if (cb) cb();
  }
}

export const lazyStore = new LazyStore();

/** Swap in a real MySQL-backed session store once DB credentials exist. */
export function attachMySQLStore(cfg: DbConfig): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const MySQLStoreFactory = require('express-mysql-session')(session);
  const store = new MySQLStoreFactory({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    createDatabaseTable: true,
    schema: {
      tableName: 'sessions',
      columnNames: {
        session_id: 'session_id',
        expires: 'expires',
        data: 'data',
      },
    },
  });
  lazyStore.attach(store);
}
