import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import path from 'path';
import fs from 'fs';
import { networkInterfaces } from 'os';
import pc from 'picocolors';
import Twig from 'twig';
import { config } from './config';
import * as db from './db';
import galaxyRouter from './routes/galaxy';
import routes from './routes/index';
import { loadUser } from './middleware/auth';
import { csrfMiddleware } from './middleware/csrf';
import { flashMiddleware } from './utils/flash';
import { lazyStore } from './session/store';

const logger = console;

const packageJsonPath = path.join(process.cwd(), 'package.json');
let SERVER_VERSION = 'unknown';
try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    SERVER_VERSION = packageJson.version || 'unknown';
} catch (err) {
    logger.error(pc.red('Could not read package.json version'));
}

const app = express();
const PORT = config.port;

// If DB credentials already exist in .env from a previous /setup run, verify
// the database on every boot before serving traffic: create it silently if
// it's missing, or drop-and-rebuild it from the latest schema.sql if its
// recorded schema_meta.version is older than this build's db.SCHEMA_VERSION
// (see ensureDatabase() in src/db/index.ts). Only once that's settled does
// the live connection pool come online.
let dbBootDone = false;
async function bootDatabase(): Promise<void> {
    if (!(config.db.host && config.db.user && config.db.database)) {
        dbBootDone = true;
        return;
    }
    const cfg = {
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
        connectionLimit: config.db.connectionLimit,
    };
    const ensured = await db.ensureDatabase(cfg);
    if (!ensured.ok) {
        db.setLastError(ensured.error);
        logger.error(pc.red('Database check failed on boot: ' + ensured.error));
        dbBootDone = true;
        return;
    }
    if (ensured.rebuilt) {
        logger.log(pc.yellow(`Database "${cfg.database}" was missing or out of date — rebuilt from src/sql/schema.sql (version ${db.SCHEMA_VERSION}).`));
    }
    db.init(cfg);
    dbBootDone = true;
}
const dbBootPromise = bootDatabase();

function getLocalIpAddress(): string {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

Twig.cache(false);
app.set('views', path.join(process.cwd(), 'src/views'));
app.set('view engine', 'twig');
app.set('trust proxy', 1);

app.use('/public', express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// FIX: session cookie now marked `secure` in production so it is never sent
// over plain HTTP once the app is deployed behind TLS.
app.use(session({
    name: config.session.name,
    secret: config.session.secret,
    store: lazyStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.env === 'production',
        maxAge: 30 * 24 * 3600 * 1000,
    },
}));
app.use(loadUser);
app.use(flashMiddleware);
app.use(csrfMiddleware);

// Every ship/planet/base/fleet/commander lives in the DB — if it isn't
// configured yet, send the visitor to the setup wizard (except the wizard's
// own routes, /reset — which must be reachable precisely when the DB is
// broken or unconfigured, see resetController.ts — and static assets).
// While the boot-time DB check (silent create / version rebuild — see
// bootDatabase() above) is still running, requests are held rather than
// incorrectly redirected to /setup, since config.db might be fully
// populated but ensureDatabase() simply hasn't finished yet.
app.use(async (req, res, next) => {
    if (!dbBootDone) await dbBootPromise;
    if (db.isReady() || req.path === '/setup' || req.path === '/reset' || req.path.startsWith('/public')) {
        next();
        return;
    }
    res.redirect('/setup');
});

app.use('/', routes);
app.use('/api/galaxy', galaxyRouter);

// FIX: 404 handler — previously unmatched routes fell straight through to the
// generic Express error page (or, for API routes, an unhelpful "Cannot GET").
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ ok: false, error: 'Not found' });
        return;
    }
    res.status(404).render('error', { title: 'Not found', code: 404, message: 'That page does not exist.' });
});

// FIX: global error-handling middleware. Previously absent, so any thrown
// error from an asyncHandler-wrapped route fell through to Express's default
// HTML error page — including for /api/galaxy/* routes whose client code
// always expects JSON (fetch(...).then(r => r.json())), which would then
// throw a confusing parse error instead of surfacing the real problem.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error(pc.red('Unhandled error:'), err);
    if (req.path.startsWith('/api/')) {
        res.status(500).json({ ok: false, error: 'Server error' });
        return;
    }
    res.status(500).render('error', {
        title: 'Error',
        code: 500,
        message: 'Something went wrong. Please try again.',
    });
});

const server = app.listen(PORT, '0.0.0.0', () => {
    const localUrl = `http://localhost:${PORT}`;
    const networkUrl = `http://${getLocalIpAddress()}:${PORT}`;
    logger.log(pc.green(`Astro Empire v${SERVER_VERSION} listening on:`));
    logger.log(pc.green(` - Local:   ${localUrl}`));
    logger.log(pc.green(` - Network: ${networkUrl}`));
});

// The boot-time DB check (silent create / version rebuild) runs
// concurrently with app.listen(); the readiness middleware above awaits it
// per-request so nothing races a still-in-progress DROP DATABASE + rebuild.
dbBootPromise.then(() => {
    if (db.getLastError()) {
        logger.log(pc.yellow(' - Database check failed — visit /setup to reconnect, or fix the error above and restart.'));
    } else if (!db.isReady()) {
        logger.log(pc.yellow(' - Database not configured yet — visit /setup to connect one.'));
    } else {
        logger.log(pc.green(' - Database ready.'));
    }
});

async function shutdown() {
    logger.log(pc.green('Shutting down gracefully...'));
    await new Promise<void>((resolve) => {
        server.close(() => {
            logger.log(pc.green('HTTP server closed'));
            resolve();
        });
    });
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
