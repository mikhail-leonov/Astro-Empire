export interface FieldErrors { [field: string]: string }

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRegistration(body: any): { valid: boolean; errors: FieldErrors; values: { username: string; email: string } } {
  const username = String(body.username ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const confirm = String(body.confirmPassword ?? '');
  const errors: FieldErrors = {};

  if (!USERNAME_RE.test(username)) errors.username = 'Username must be 3-20 characters: letters, numbers, underscores.';
  if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';
  if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
  if (password !== confirm) errors.confirmPassword = 'Passwords do not match.';

  return { valid: Object.keys(errors).length === 0, errors, values: { username, email } };
}

export function validateLogin(body: any): { valid: boolean; errors: FieldErrors; values: { identifier: string } } {
  const identifier = String(body.identifier ?? '').trim();
  const password = String(body.password ?? '');
  const errors: FieldErrors = {};

  if (!identifier) errors.identifier = 'Enter your username or email.';
  if (!password) errors.password = 'Enter your password.';

  return { valid: Object.keys(errors).length === 0, errors, values: { identifier } };
}

export function validateDbSettings(body: any): { valid: boolean; errors: FieldErrors; values: { host: string; port: string; user: string; database: string } } {
  const host = String(body.host ?? '').trim();
  const port = String(body.port ?? '3306').trim();
  const user = String(body.user ?? '').trim();
  const database = String(body.database ?? '').trim();
  const errors: FieldErrors = {};

  if (!host) errors.host = 'Host is required.';
  if (!/^\d+$/.test(port) || +port < 1 || +port > 65535) errors.port = 'Enter a valid port number.';
  if (!user) errors.user = 'Database user is required.';
  if (!database || !/^[a-zA-Z0-9_]+$/.test(database)) errors.database = 'Database name must be letters, numbers, underscores.';

  return { valid: Object.keys(errors).length === 0, errors, values: { host, port, user, database } };
}
