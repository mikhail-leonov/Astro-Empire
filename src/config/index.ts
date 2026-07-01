import dotenv from 'dotenv';

dotenv.config();

function str(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}
function int(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

export const config = {
  env: str('NODE_ENV', 'development'),
  port: int('PORT', 3000),
  db: {
    // Left empty by default (rather than a guessed default like 'localhost')
    // so db.isReady() can tell "never configured" apart from "configured".
    // The /setup wizard fills these in and persists them to .env.
    host: str('DB_HOST', ''),
    port: int('DB_PORT', 3306),
    user: str('DB_USER', ''),
    password: str('DB_PASSWORD', ''),
    database: str('DB_NAME', 'astro_empire'),
    connectionLimit: int('DB_CONNECTION_LIMIT', 10),
  },
  session: {
    name: str('SESSION_NAME', 'astro.sid'),
    secret: str('SESSION_SECRET', 'change-me-insecure-dev-secret'),
  },
};
export type AppConfig = typeof config;
