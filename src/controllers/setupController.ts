import crypto from 'crypto';
import type { Request, Response } from 'express';
import * as db from '../db';
import type { DbConfig } from '../db';
import { config } from '../config';
import { validateDbSettings } from '../utils/validation';
import { updateEnv } from '../utils/envFile';
import { attachMySQLStore } from '../session/store';

function currentValues() {
  return {
    host: config.db.host,
    port: String(config.db.port),
    user: config.db.user,
    database: config.db.database,
  };
}

/* ---------------------------------------------------------- GET /setup */
export function showSetup(_req: Request, res: Response): void {
  if (db.isReady()) {
    res.redirect('/');
    return;
  }
  const lastError = db.getLastError();
  res.render('setup', {
    title: 'Database setup',
    errors: lastError ? { _form: `Last connection attempt failed: ${lastError}` } : {},
    old: currentValues(),
  });
}

/* ---------------------------------------------------------- POST /setup */
export async function saveSetup(req: Request, res: Response): Promise<void> {
  if (db.isReady()) {
    res.redirect('/');
    return;
  }

  const { valid, errors, values } = validateDbSettings(req.body);
  const password = String(req.body.password ?? '');

  if (!valid) {
    res.status(422).render('setup', { title: 'Database setup', errors, old: values });
    return;
  }

  const cfg: DbConfig = {
    host: values.host,
    port: parseInt(values.port, 10),
    user: values.user,
    password,
    database: values.database,
    connectionLimit: config.db.connectionLimit,
  };

  // 1. Validate credentials, create the database + tables if missing.
  const ensured = await db.ensureDatabase(cfg);
  if (!ensured.ok) {
    // FIX: record the failure so isReady() keeps reporting "not ready" and
    // GET /setup keeps showing this reason, instead of the person being
    // bounced back here with no explanation, or — worse — later ending up
    // stuck at a dead end where isReady() falsely reports true and /setup
    // just redirects to '/' with no way back in (see db.isReady() for why
    // that used to happen).
    db.setLastError(ensured.error);
    res.status(422).render('setup', {
      title: 'Database setup',
      errors: { _form: `Could not connect: ${ensured.error}` },
      old: values,
    });
    return;
  }

  // 2. Point the live pool at the new config and confirm it works.
  await db.reset();
  db.init(cfg);
  const healthy = await db.healthCheck();
  if (!healthy) {
    // FIX: db.init(cfg) above already pointed the pool at this (apparently
    // bad) config, which used to make isReady() report true from that point
    // on — locking the person out of /setup on every subsequent request
    // even though the connection never actually worked. Reset the pool and
    // flag the failure so isReady() goes back to false and the form is
    // reachable again.
    await db.reset();
    db.setLastError('Database created but the connection test failed. Please re-check the details.');
    res.status(422).render('setup', {
      title: 'Database setup',
      errors: { _form: 'Database created but the connection test failed. Please re-check the details.' },
      old: values,
    });
    return;
  }
  db.setLastError(null);

  // 3. Persist settings to .env (also generate a session secret if still default).
  const envUpdates: Record<string, string> = {
    DB_HOST: cfg.host,
    DB_PORT: String(cfg.port),
    DB_USER: cfg.user,
    DB_PASSWORD: cfg.password,
    DB_NAME: cfg.database,
  };

  const weakSecret = !config.session.secret || /change|insecure/i.test(config.session.secret);
  if (weakSecret) {
    const secret = crypto.randomBytes(32).toString('hex');
    envUpdates.SESSION_SECRET = secret;
    config.session.secret = secret;
  }

  try {
    updateEnv(envUpdates);
  } catch (e) {
    // Connection works in-memory; only the file write failed. Warn but proceed.
    res.render('setup-success', {
      title: 'Setup complete',
      warn: `Connected successfully, but writing .env failed: ${(e as Error).message}. ` +
        `Update the file manually so settings survive a restart.`,
    });
    finalizeEnv(cfg);
    return;
  }

  finalizeEnv(cfg);
  res.render('setup-success', { title: 'Setup complete', warn: null });
}

/** Mirror settings into process.env and bring the MySQL session store online. */
function finalizeEnv(cfg: DbConfig): void {
  process.env.DB_HOST = cfg.host;
  process.env.DB_PORT = String(cfg.port);
  process.env.DB_USER = cfg.user;
  process.env.DB_PASSWORD = cfg.password;
  process.env.DB_NAME = cfg.database;

  config.db.host = cfg.host;
  config.db.port = cfg.port;
  config.db.user = cfg.user;
  config.db.password = cfg.password;
  config.db.database = cfg.database;

  attachMySQLStore(cfg);
}
