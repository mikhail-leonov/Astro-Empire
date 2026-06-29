import fs from 'fs';
import path from 'path';

const ENV_PATH = path.join(process.cwd(), '.env');

/**
 * Quote a value for .env so it round-trips correctly through dotenv.
 * dotenv does not unescape characters inside DOUBLE quotes (and it expands
 * \n, \r, ... there), but treats SINGLE-quoted values literally. So we pick the
 * quote style based on the content.
 */
function serialize(value: string): string {
  if (value === '') return '""';

  // No characters that require quoting -> write bare.
  if (!/[\s#"'`$\\]/.test(value)) return value;

  // Safe to double-quote (no embedded " and no backslash that dotenv would
  // misinterpret as an escape sequence).
  if (!value.includes('"') && !value.includes('\\')) return `"${value}"`;

  // Contains " or \ but no single quote -> single-quote literally.
  if (!value.includes("'")) return `'${value}'`;

  // Extremely rare: contains both quote styles. Best effort with double quotes.
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Merge the given key/value pairs into the .env file, preserving existing
 * lines/comments. Existing keys are replaced in place; new keys are appended.
 * Creates the file if it does not exist.
 */
export function updateEnv(updates: Record<string, string>): void {
  let lines: string[] = [];
  if (fs.existsSync(ENV_PATH)) {
    lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  }

  const seen = new Set<string>();
  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && Object.prototype.hasOwnProperty.call(updates, m[1])) {
      seen.add(m[1]);
      return `${m[1]}=${serialize(updates[m[1]])}`;
    }
    return line;
  });

  for (const key of Object.keys(updates)) {
    if (!seen.has(key)) out.push(`${key}=${serialize(updates[key])}`);
  }

  const content = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n');
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}
