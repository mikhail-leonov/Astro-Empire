import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import session from 'express-session';
import path from 'path';
import fs from 'fs';
import { networkInterfaces } from 'os';
import pc from 'picocolors';
import Twig from 'twig';

import { config } from './config';
import * as db from './db';
import routes from './routes';
import { flashMiddleware } from './utils/flash';
import { csrfMiddleware } from './middleware/csrf';
import { loadUser } from './middleware/auth';
import { lazyStore, attachMySQLStore } from './session/store';

const logger = console;
const app = express();

/* ---------------------------------------------------------- version */
let SERVER_VERSION = 'unknown';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
  SERVER_VERSION = pkg.version || 'unknown';
} catch {
  logger.error(pc.red('Could not read package.json version'));
}

function getLocalIpAddress(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

/* ---------------------------------------------------------- views */
Twig.cache(config.env === 'production');
app.set('views', path.join(process.cwd(), 'src/views'));
app.set('view engine', 'twig');
app.locals.appName = 'Astro Empire';
app.locals.version = SERVER_VERSION;

/* ---------------------------------------------------------- static + parsers */
app.use('/public', express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------------------------------------------------------- sessions
 * Uses a swappable store: in-memory until the database is configured (so the
 * setup wizard works), then swapped to MySQL with no restart. */
app.use(
  session({
    name: config.session.name,
    secret: config.session.secret,
    store: lazyStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.env === 'production',
      maxAge: config.session.maxAge,
    },
  })
);

app.use(flashMiddleware);
app.use(csrfMiddleware);
app.use(loadUser);

/* ---------------------------------------------------------- setup gate
 * When the DB is unreachable, funnel everything to the setup wizard. */
app.use((req: Request, res: Response, next: NextFunction) => {
  if (db.isReady() || req.path === '/setup') return next();
  return res.redirect('/setup');
});

/* ---------------------------------------------------------- routes */
app.use('/', routes);

/* ---------------------------------------------------------- 404 */
app.use((_req: Request, res: Response) => {
  res.status(404).render('error', {
    title: 'Not found',
    code: 404,
    message: 'That sector of space does not exist.',
  });
});

/* ---------------------------------------------------------- error handler */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error(pc.red(err.stack || err.message || String(err)));
  res.status(500).render('error', {
    title: 'Error',
    code: 500,
    message: 'An unexpected error occurred. Please try again.',
  });
});

/* ---------------------------------------------------------- start */
async function start(): Promise<void> {
  // Try the configured database; if it isn't reachable we boot into setup mode.
  db.init(config.db);
  const healthy = await db.healthCheck();
  if (healthy) {
    try {
      attachMySQLStore(config.db);
    } catch (e) {
      logger.error(pc.red(`Failed to attach MySQL session store: ${(e as Error).message}`));
    }
  }

  const server = app.listen(config.port, '0.0.0.0', () => {
    const localUrl = `http://localhost:${config.port}`;
    const networkUrl = `http://${getLocalIpAddress()}:${config.port}`;
    logger.log(pc.green(`Astro Empire v${SERVER_VERSION} listening on:`));
    logger.log(pc.green(` - Local:   ${localUrl}`));
    logger.log(pc.green(` - Network: ${networkUrl}`));
    if (healthy) {
      logger.log(pc.green(' - Database connected.'));
    } else {
      logger.log(pc.yellow(' - Database NOT reachable — open the app to run first-time setup:'));
      logger.log(pc.yellow(`   ${localUrl}/setup`));
    }
  });

  async function shutdown(): Promise<void> {
    logger.log(pc.green('Shutting down gracefully...'));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.reset();
    logger.log(pc.green('Closed. Bye.'));
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((e) => {
  logger.error(pc.red(`Fatal startup error: ${(e as Error).message}`));
  process.exit(1);
});
