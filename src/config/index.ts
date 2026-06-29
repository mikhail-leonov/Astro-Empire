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

  session: {
    secret: str('SESSION_SECRET', 'insecure-dev-secret-change-me'),
    name: str('SESSION_NAME', 'astro.sid'),
    maxAge: int('SESSION_MAX_AGE_MS', 7 * 24 * 60 * 60 * 1000),
  },

  db: {
    host: str('DB_HOST', 'localhost'),
    port: int('DB_PORT', 3306),
    user: str('DB_USER', 'root'),
    password: str('DB_PASSWORD', ''),
    database: str('DB_NAME', 'astro_empire'),
    connectionLimit: int('DB_POOL', 10),
  },
};

export type AppConfig = typeof config;
