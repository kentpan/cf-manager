CREATE TABLE IF NOT EXISTS accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  auth_type       TEXT NOT NULL CHECK(auth_type IN ('token', 'global_key')),
  api_token       TEXT,
  api_key         TEXT,
  email           TEXT,
  account_id      TEXT,
  is_active       INTEGER DEFAULT 1,
  enabled_features TEXT DEFAULT 'ai,workers,browser_render,dns,storage',
  password        TEXT,
  available_features TEXT DEFAULT '',
  proxy_url       TEXT DEFAULT '',
  proxy_enabled   INTEGER DEFAULT 0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS quota_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  resource    TEXT NOT NULL,
  date        DATE NOT NULL,
  count       INTEGER DEFAULT 0,
  optimistic  INTEGER DEFAULT 0,
  exhausted   INTEGER DEFAULT 0,
  UNIQUE(account_id, resource, date)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  detail      TEXT,
  status      TEXT NOT NULL CHECK(status IN ('success', 'error')),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  url           TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  is_default    INTEGER DEFAULT 0,
  enabled       INTEGER DEFAULT 1,
  last_synced   DATETIME,
  last_status   TEXT DEFAULT 'pending',
  last_error    TEXT,
  etag          TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Free-domain provider registry (DNSHE, Namecheap, GoDaddy, Dynadot,
-- Aliyun, Tencent, Namesilo, Porkbun, Cloudflare Registrar, ...).
-- Each row describes *how* to talk to a registrar's API; account-level
-- credentials live in domain_provider_accounts.
CREATE TABLE IF NOT EXISTS domain_providers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  api_base_url  TEXT NOT NULL,
  auth_type     TEXT NOT NULL DEFAULT 'header',
  capabilities  TEXT DEFAULT '',
  doc_url       TEXT DEFAULT '',
  register_url  TEXT DEFAULT '',
  promo_url     TEXT DEFAULT '',
  regions       TEXT DEFAULT 'GLOBAL',
  description   TEXT DEFAULT '',
  commission_model TEXT DEFAULT '',
  registration_steps TEXT DEFAULT '',
  credential_fields TEXT DEFAULT '',
  is_default    INTEGER DEFAULT 0,
  enabled       INTEGER DEFAULT 1,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS domain_provider_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id   INTEGER NOT NULL REFERENCES domain_providers(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  api_key       TEXT,
  api_secret    TEXT,
  api_user      TEXT,
  is_active     INTEGER DEFAULT 1,
  last_synced   DATETIME,
  last_error    TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_domain_provider_accounts_provider ON domain_provider_accounts(provider_id);
