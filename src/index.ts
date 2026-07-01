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

// If DB credentials already exist in .env from a previous /setup run, bring
// the pool online immediately so every commander's ships/planets/bases/fleets
// are reachable without re-running the wizard.
if (config.db.host && config.db.user && config.db.database) {
    db.init({
        host: config.db.host,
        port: config.db.port,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database,
        connectionLimit: config.db.connectionLimit,
    });
}

const app = express();
const PORT = config.port;

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

app.use(session({
    name: config.session.name,
    secret: config.session.secret,
    store: lazyStore,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 },
}));
app.use(loadUser);
app.use(flashMiddleware);
app.use(csrfMiddleware);

// Every ship/planet/base/fleet/commander lives in the DB — if it isn't
// configured yet, send the visitor to the setup wizard (except the wizard's
// own routes and static assets).
app.use((req, res, next) => {
    if (db.isReady() || req.path === '/setup' || req.path.startsWith('/public')) {
        next();
        return;
    }
    res.redirect('/setup');
});

app.use('/', routes);
app.use('/api/galaxy', galaxyRouter);

const server = app.listen(PORT, '0.0.0.0', () => {
    const localUrl = `http://localhost:${PORT}`;
    const networkUrl = `http://${getLocalIpAddress()}:${PORT}`;
    logger.log(pc.green(`Astro Empire v${SERVER_VERSION} listening on:`));
    logger.log(pc.green(` - Local:   ${localUrl}`));
    logger.log(pc.green(` - Network: ${networkUrl}`));
    if (!db.isReady()) {
        logger.log(pc.yellow(' - Database not configured yet — visit /setup to connect one.'));
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
