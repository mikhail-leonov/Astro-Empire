import fs from 'fs';
import path from 'path';

const ENV_PATH = path.join(process.cwd(), '.env');

/** Merge key/value pairs into the .env file, preserving unrelated existing lines. */
export function updateEnv(updates: Record<string, string>): void {
  let lines: string[] = [];
  if (fs.existsSync(ENV_PATH)) {
    lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  }
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const m = line.match(/^([A-Z0-9_]+)=/);
    if (m && Object.prototype.hasOwnProperty.call(updates, m[1])) {
      seen.add(m[1]);
      return `${m[1]}=${escapeEnvValue(updates[m[1]])}`;
    }
    return line;
  }).filter((l, i, arr) => !(l === '' && i === arr.length - 1));

  for (const key of Object.keys(updates)) {
    if (!seen.has(key)) out.push(`${key}=${escapeEnvValue(updates[key])}`);
  }

  fs.writeFileSync(ENV_PATH, out.join('\n') + '\n', 'utf8');
}

function escapeEnvValue(v: string): string {
  if (/[\s#"']/.test(v)) return `"${v.replace(/"/g, '\\"')}"`;
  return v;
}
