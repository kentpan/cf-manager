#!/usr/bin/env node
/**
 * reset-credentials.js
 *
 * Diagnostic + repair utility for the cf-manager SQLite database.
 *
 * Symptom it fixes
 * ----------------
 *   "Failed to decrypt credentials for account N: Error: Unsupported state
 *    or unable to authenticate data"
 *
 * That error is raised by Node's `crypto.createDecipheriv('aes-256-gcm', ...)`
 * when the AES-GCM auth tag does not validate. In cf-manager this happens
 * when the `ENCRYPTION_KEY` in `.env` does not match the key that was used
 * to encrypt the credentials currently stored in `accounts.api_token` /
 * `accounts.api_key` / `accounts.password`.
 *
 * Common triggers:
 *   - Re-pulling the repo and getting a different `.env` (new random key)
 *   - Switching between the Docker default key and a custom key
 *   - Manual DB copy from another host without copying `.env`
 *
 * What this script does
 * --------------------
 * 1. Opens `backend/data/cf-manager.db` (path configurable via DB_PATH env).
 * 2. For every row in `accounts`, attempts to decrypt each encrypted field
 *    using the current `ENCRYPTION_KEY`.
 * 3. If decryption fails for any field, sets that field (and any other
 *    encrypted fields on the same row) to NULL and marks the account
 *    `is_active = 0` so it stops breaking background sync / aggregator
 *    requests. The account record itself is preserved so the user can
 *    re-enter credentials in the management UI without losing metadata
 *    (name, email, account_id, features, etc.).
 * 4. Prints a per-account report at the end.
 *
 * Usage
 * -----
 *   node scripts/reset-credentials.js              # dry-run, prints report only
 *   node scripts/reset-credentials.js --apply       # actually wipe broken fields
 *   DB_PATH=/path/to/cf-manager.db node scripts/reset-credentials.js --apply
 *
 * Exit codes
 * ----------
 *   0 — all credentials healthy, or broken credentials wiped successfully
 *   1 — broken credentials found in dry-run mode (use --apply to fix)
 *   2 — fatal error (DB not found, etc.)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env from project root (cf-manager/.env) so ENCRYPTION_KEY matches
// what the running backend uses.
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'feiyu';
const DB_PATH = process.env.DB_PATH || path.join(root, 'backend', 'data', 'cf-manager.db');
const APPLY = process.argv.includes('--apply');

if (!fs.existsSync(DB_PATH)) {
  console.error(`[reset-credentials] DB not found at ${DB_PATH}`);
  console.error('  Set DB_PATH env var if your database lives elsewhere.');
  process.exit(2);
}

// Mirror encryptionService.getKey() — accept 64-hex or arbitrary string.
function getKey() {
  if (/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY)) {
    return Buffer.from(ENCRYPTION_KEY, 'hex');
  }
  return crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY = getKey();

function tryDecrypt(ciphertext) {
  if (!ciphertext || typeof ciphertext !== 'string') return { ok: true, value: null };
  const parts = ciphertext.split(':');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  try {
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const enc = parts[2];
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(tag);
    let plain = decipher.update(enc, 'hex', 'utf8');
    plain += decipher.final('utf8');
    return { ok: true, value: plain };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

let Database;
try {
  Database = require(path.join(root, 'backend', 'node_modules', 'better-sqlite3'));
} catch {
  try {
    Database = require('better-sqlite3');
  } catch (e) {
    console.error('[reset-credentials] better-sqlite3 not found. Run from the cf-manager root after `cd backend && npm install`.');
    process.exit(2);
  }
}

const db = new Database(DB_PATH);

// Make sure the table exists (mirrors backend/src/db.ts)
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    auth_type   TEXT NOT NULL,
    api_token   TEXT,
    api_key     TEXT,
    email       TEXT,
    account_id  TEXT,
    is_active   INTEGER DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const rows = db.prepare('SELECT id, name, auth_type, email, account_id, is_active, api_token, api_key, password FROM accounts').all();

console.log(`[reset-credentials] DB: ${DB_PATH}`);
console.log(`[reset-credentials] ENCRYPTION_KEY fingerprint: ${KEY.toString('hex').slice(0, 16)}… (sha256 of "${ENCRYPTION_KEY.slice(0, 4)}…")`);
console.log(`[reset-credentials] mode: ${APPLY ? 'APPLY (will wipe broken fields)' : 'DRY-RUN (use --apply to fix)'}`);
console.log(`[reset-credentials] accounts: ${rows.length}`);
console.log('');

const broken = [];
const healthy = [];

for (const row of rows) {
  const tokRes = tryDecrypt(row.api_token);
  const keyRes = tryDecrypt(row.api_key);
  const pwRes = tryDecrypt(row.password);

  if (tokRes.ok && keyRes.ok && pwRes.ok) {
    healthy.push(row);
    console.log(`  ✓ account ${row.id} "${row.name}" — OK`);
    continue;
  }

  const failures = [];
  if (!tokRes.ok) failures.push(`api_token(${tokRes.reason})`);
  if (!keyRes.ok) failures.push(`api_key(${keyRes.reason})`);
  if (!pwRes.ok) failures.push(`password(${pwRes.reason})`);

  console.log(`  ✗ account ${row.id} "${row.name}" — BROKEN: ${failures.join(', ')}`);
  broken.push({ row, failures });

  if (APPLY) {
    db.prepare(`
      UPDATE accounts
      SET api_token = NULL,
          api_key = NULL,
          password = NULL,
          is_active = 0,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(row.id);
    console.log(`    → wiped encrypted fields + marked is_active=0`);
  }
}

console.log('');
console.log(`[reset-credentials] summary: ${healthy.length} healthy, ${broken.length} broken`);

if (broken.length > 0 && !APPLY) {
  console.log('');
  console.log('To wipe the broken encrypted fields (account metadata will be preserved,');
  console.log('you can re-enter credentials in the management UI afterwards):');
  console.log('');
  console.log('  node scripts/reset-credentials.js --apply');
  process.exit(1);
}

if (APPLY && broken.length > 0) {
  console.log('');
  console.log(`[reset-credentials] ✓ wiped broken credentials for ${broken.length} account(s).`);
  console.log('[reset-credentials] Restart the backend so caches are cleared, then re-enter');
  console.log('[reset-credentials] credentials in 账号管理 → 编辑 for each affected account.');
}

db.close();
process.exit(0);
