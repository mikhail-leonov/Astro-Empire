import type { Request, Response } from 'express';
import * as db from '../db';
import type { DbConfig } from '../db';
import { config } from '../config';

/**
 * GET /reset — drop and recreate the database from src/sql/schema.sql,
 * applying src/sql/seed.sql afterwards if that file exists on disk.
 *
 * Reachable "at any stage": before /setup has ever run (nothing to reset —
 * redirects there instead), while the app is mid-boot-failure (bad
 * credentials, out-of-date schema, etc.), or against a fully working
 * install.
 *
 * ⚠️ DEV-ONLY, NO ACCESS CONTROL — TEMPORARY FOR THE DEVELOPMENT PERIOD ⚠️
 * This is a bare, unauthenticated GET endpoint that destroys all data,
 * reachable by anybody: no login, no admin check, nothing. That is normally
 * a serious problem on its own even before considering who's allowed to
 * trigger it — a stray `<img src="/reset">`, a link crawler, browser
 * prefetch, or literally anyone who finds the URL can wipe the database
 * with zero user intent involved.
 *
 * This previously required an authenticated admin session whenever the
 * database already had real accounts in it (db.hasExistingUsers()), and
 * only ran unauthenticated against an empty/fresh database. That check has
 * been removed here at explicit request for local development convenience.
 * Before this app is exposed anywhere other than a local dev machine, either
 * restore that gate, remove this route/controller entirely, or put it
 * behind its own auth — an unauthenticated destructive GET route deployed
 * for real is exactly the class of bug the rest of this review fixed.
 */
export async function resetDatabase(req: Request, res: Response): Promise<void> {
  const { host, user, database } = config.db;
  if (!host || !user || !database) {
    // Nothing has been configured yet — /setup is the right place to start,
    // there is no database to reset.
    res.redirect('/setup');
    return;
  }

  const cfg: DbConfig = {
    host,
    port: config.db.port,
    user,
    password: config.db.password,
    database,
    connectionLimit: config.db.connectionLimit,
  };

  await db.reset(); // drop the live pool before we drop the database out from under it
  const result = await db.forceRebuildDatabase(cfg);
  if (!result.ok) {
    db.setLastError(result.error);
    res.status(500).render('error', {
      title: 'Reset failed',
      code: 500,
      message: result.error,
    });
    return;
  }

  db.init(cfg);

  // The `sessions` table (and everything else) was just dropped and
  // recreated empty, so the current session's row is already gone from the
  // store. Destroy it clientside too rather than letting express-session
  // try to save a session back to a table that no longer has that row,
  // and so the response doesn't imply the visitor is still logged in.
  req.session.destroy(() => {
    res.clearCookie(config.session.name);
    res.render('reset-success', { title: 'Database reset', seeded: result.seeded });
  });
}
