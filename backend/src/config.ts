import path from 'path';
import fs from 'fs';

// Load .env from project root so encryption key stays stable across restarts
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: path.join(__dirname, '..', '..', '.env') });

// Detect whether we're running on Cloudflare's edge (Workers / Pages) or in
// the Node backend. The worker build sets `process.env.CF_PAGES` or
// `process.env.WORKER` — we use the absence of `better-sqlite3` capability
// as the canonical signal since the worker runtime doesn't have Node fs.
//
// This matters for the baseURL config: on Node we can write to .env; on
// the edge runtime there's no filesystem, so the UI must show a "set this
// via the Cloudflare dashboard / wrangler.toml and redeploy" hint instead.
const isCloudflareEdge = typeof (globalThis as any).caches !== 'undefined'
  && typeof (globalThis as any).CF_PAGES !== 'undefined';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  encryptionKey: process.env.ENCRYPTION_KEY || 'feiyu',
  apiSecret: process.env.API_SECRET || '',
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'cf-manager.db'),
  proxyUrl: process.env.PROXY_URL || '',
  demoAccountIds: process.env.DEMO_ACCOUNT_IDS || '',
  // baseURL: when non-empty, the SPA's vue-router uses this as the base path.
  // Default '/' (root). Set to '/admin/' for the disguised-nginx layout.
  // On Node we can update it at runtime via PUT /api/settings/base-url (writes
  // to .env); on Cloudflare edge it's read from [vars] in wrangler.toml and
  // can only be changed by redeploying.
  baseUrl: process.env.BASE_URL || '/',
  isCloudflareEdge,
  // Absolute path to .env so the settings route can rewrite it when the user
  // changes BASE_URL on Node. Always points at cf-manager/.env.
  envPath: path.join(__dirname, '..', '..', '.env'),
};

/**
 * Returns true if the .env file is writable. Used by the settings route to
 * decide whether to allow runtime BASE_URL changes (Node) or to show the
 * "edit wrangler.toml + redeploy" hint (Cloudflare edge).
 */
export function isEnvWritable(): boolean {
  if (isCloudflareEdge) return false;
  try {
    fs.accessSync(config.envPath, fs.constants.W_OK);
    return true;
  } catch {
    // .env might not exist yet — check the parent directory is writable
    try {
      fs.accessSync(path.dirname(config.envPath), fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Read the current .env file as a key=value map. Returns {} if .env doesn't
 * exist. Used by the settings route so we can rewrite BASE_URL while
 * preserving every other key the user has set.
 */
export function readEnvFile(): Record<string, string> {
  const map: Record<string, string> = {};
  if (isCloudflareEdge) return map;
  try {
    const content = fs.readFileSync(config.envPath, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      // Strip surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      map[key] = value;
    }
  } catch { /* file doesn't exist */ }
  return map;
}

/**
 * Write the .env file from a key=value map. Preserves a leading comment
 * header pointing at .env.example for discoverability. Overwrites the
 * whole file (atomic write).
 */
export function writeEnvFile(map: Record<string, string>): void {
  if (isCloudflareEdge) {
    throw new Error('Cannot write .env on Cloudflare edge runtime — set BASE_URL in wrangler.toml [vars] and redeploy.');
  }
  const lines: string[] = [
    '# cf-manager .env — auto-managed by the settings route.',
    '# Edit at https://your-host/admin/#/settings or directly in this file.',
    '',
  ];
  for (const [key, value] of Object.entries(map)) {
    // Quote values that contain spaces or special chars
    if (/[.#=\s]/.test(value) && !(value.startsWith('"') && value.endsWith('"'))) {
      lines.push(`${key}="${value}"`);
    } else {
      lines.push(`${key}=${value}`);
    }
  }
  fs.writeFileSync(config.envPath, lines.join('\n') + '\n', 'utf-8');
}
