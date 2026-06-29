const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ValidationResult<V> {
  valid: boolean;
  errors: Record<string, string>;
  values: V;
}

export function validateRegistration(body: Record<string, unknown>): ValidationResult<{
  username: string;
  email: string;
}> {
  const errors: Record<string, string> = {};
  const username = String(body.username ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const confirm = String(body.confirm ?? '');

  if (!USERNAME_RE.test(username)) {
    errors.username = '3–32 characters: letters, numbers and underscores only.';
  }
  if (!EMAIL_RE.test(email) || email.length > 255) {
    errors.email = 'Enter a valid email address.';
  }
  if (password.length < 8) {
    errors.password = 'Password must be at least 8 characters.';
  } else if (password.length > 200) {
    errors.password = 'Password is too long.';
  }
  if (password !== confirm) {
    errors.confirm = 'Passwords do not match.';
  }

  return { valid: Object.keys(errors).length === 0, errors, values: { username, email } };
}

const DB_NAME_RE = /^[A-Za-z0-9_]{1,64}$/;

export function validateDbSettings(body: Record<string, unknown>): ValidationResult<{
  host: string;
  port: string;
  user: string;
  database: string;
}> {
  const errors: Record<string, string> = {};
  const host = String(body.host ?? '').trim();
  const portRaw = String(body.port ?? '').trim();
  const user = String(body.user ?? '').trim();
  const database = String(body.database ?? '').trim();

  if (!host) errors.host = 'Enter the database host (e.g. localhost).';
  const port = parseInt(portRaw || '3306', 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) errors.port = 'Enter a valid port (1–65535).';
  if (!user) errors.user = 'Enter the database user.';
  if (!DB_NAME_RE.test(database)) {
    errors.database = 'Database name: 1–64 characters, letters/numbers/underscore only.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    values: { host, port: String(port), user, database },
  };
}

export function validateLogin(body: Record<string, unknown>): ValidationResult<{
  identifier: string;
}> {
  const errors: Record<string, string> = {};
  const identifier = String(body.identifier ?? '').trim();
  const password = String(body.password ?? '');

  if (!identifier) errors.identifier = 'Enter your username or email.';
  if (!password) errors.password = 'Enter your password.';

  return { valid: Object.keys(errors).length === 0, errors, values: { identifier } };
}
