export interface Account {
  id: number;
  name: string;
  auth_type: 'token' | 'global_key';
  api_token: string | null;
  api_key: string | null;
  email: string | null;
  account_id: string | null;
  is_active: number;
  enabled_features: string;
  created_at: string;
  updated_at: string;
  available_features: string;
  proxy_url: string;
  proxy_enabled: number;
}

export type AccountFeature = 'ai' | 'workers' | 'browser_render' | 'dns' | 'storage';

export function hasFeature(account: Account, feature: AccountFeature): boolean {
  return (account.enabled_features || '').split(',').map(f => f.trim()).includes(feature);
}

export interface QuotaUsage {
  id: number;
  account_id: number;
  resource: string;
  date: string;
  count: number;
  optimistic: number;
  exhausted: number;
}

export interface AuditLogRow {
  id: number;
  account_id: number | null;
  action: string;
  target: string | null;
  detail: string | null;
  status: string;
  created_at: string;
  account_name?: string;
}

// ============ Account queries ============

export async function getActiveAccounts(db: D1Database): Promise<Account[]> {
  const { results } = await db.prepare('SELECT * FROM accounts WHERE is_active = 1 ORDER BY name').all<Account>();
  return results;
}

export async function getActiveAccountsByFeature(db: D1Database, feature: AccountFeature): Promise<Account[]> {
  const all = await getActiveAccounts(db);
  return all.filter(a => hasFeature(a, feature));
}

export async function getAllAccounts(db: D1Database): Promise<Account[]> {
  const { results } = await db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all<Account>();
  return results;
}

export type AccountListFilter = 'all' | 'active' | 'unverified';

export interface PagedAccounts {
  accounts: Account[];
  total: number;
  counts: { all: number; active: number; unverified: number };
}

/**
 * 分页查询账户，支持按 active/unverified 筛选 + 按名称/邮箱模糊搜索
 */
export async function listAccountsPaged(db: D1Database, opts: {
  page: number;
  pageSize: number;
  filter?: AccountListFilter;
  search?: string;
}): Promise<PagedAccounts> {
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.max(1, Math.min(500, opts.pageSize || 20));
  const filter = opts.filter || 'all';
  const search = (opts.search || '').trim();

  const where: string[] = [];
  const params: any[] = [];
  if (filter === 'active') {
    where.push('is_active = 1');
  } else if (filter === 'unverified') {
    where.push('is_active = 0');
  }
  if (search) {
    where.push('(name LIKE ? OR email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const whereSql = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

  const totalRow = await db.prepare(`SELECT COUNT(*) as c FROM accounts ${whereSql}`).bind(...params).first<{ c: number }>();
  const total = totalRow?.c ?? 0;
  const offset = (page - 1) * pageSize;
  const { results } = await db
    .prepare(`SELECT * FROM accounts ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...params, pageSize, offset)
    .all<Account>();

  const [allRow, activeRow, unverifiedRow] = await Promise.all([
    db.prepare('SELECT COUNT(*) as c FROM accounts').first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) as c FROM accounts WHERE is_active = 1').first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) as c FROM accounts WHERE is_active = 0').first<{ c: number }>(),
  ]);

  return {
    accounts: results,
    total,
    counts: {
      all: allRow?.c ?? 0,
      active: activeRow?.c ?? 0,
      unverified: unverifiedRow?.c ?? 0,
    },
  };
}

export async function getAccountById(db: D1Database, id: number): Promise<Account | null> {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<Account>();
}

export async function createAccount(db: D1Database, data: {
  name: string; auth_type: string; api_token?: string; api_key?: string;
  email?: string; account_id?: string; enabled_features?: string; proxy_url?: string; proxy_enabled?: number;
}): Promise<number> {
  const res = await db.prepare(
    'INSERT INTO accounts (name, auth_type, api_token, api_key, email, account_id, enabled_features, proxy_url, proxy_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(data.name, data.auth_type, data.api_token || null, data.api_key || null,
    data.email || null, data.account_id || null, data.enabled_features || 'ai,workers,browser_render,dns,storage',
    data.proxy_url || '', data.proxy_enabled ?? 0).run();
  return res.meta.last_row_id;
}

export async function updateAccount(db: D1Database, id: number, data: Partial<Account>): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined && !['id', 'created_at'].includes(key)) {
      sets.push(`${key} = ?`);
      vals.push(val);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  await db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
}

export async function deleteAccount(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();
}

export async function getAccountByEmail(db: D1Database, email: string): Promise<Account | null> {
  return db.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first<Account>();
}

/**
 * 从邮箱中提取账户名。
 * 实现来自 shared/accountUtils.ts（由 scripts/sync-shared.js 同步），
 * 避免在两端维护两份相同逻辑。
 */
export { nameFromEmail } from '../services/accountUtils';

// ============ Quota queries ============

export async function getAllQuotaToday(db: D1Database): Promise<QuotaUsage[]> {
  const today = new Date().toISOString().split('T')[0];
  const { results } = await db.prepare('SELECT * FROM quota_usage WHERE date = ?').bind(today).all<QuotaUsage>();
  return results;
}

export async function setQuota(db: D1Database, accountId: number, resource: string, count: number): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  await db.prepare(
    `INSERT INTO quota_usage (account_id, resource, date, count) VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, resource, date) DO UPDATE SET count = ?`
  ).bind(accountId, resource, today, count, count).run();
}

export async function incrementQuota(db: D1Database, accountId: number, resource: string, amount: number): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  await db.prepare(
    `INSERT INTO quota_usage (account_id, resource, date, count) VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, resource, date) DO UPDATE SET count = count + ?`
  ).bind(accountId, resource, today, amount, amount).run();
}

export async function getQuotaByAccount(db: D1Database, accountId: number, resource: string): Promise<QuotaUsage | null> {
  const today = new Date().toISOString().split('T')[0];
  return db.prepare('SELECT * FROM quota_usage WHERE account_id = ? AND resource = ? AND date = ?')
    .bind(accountId, resource, today).first<QuotaUsage>();
}

export async function setExhausted(db: D1Database, accountId: number, resource: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  await db.prepare(
    `INSERT INTO quota_usage (account_id, resource, date, count, exhausted) VALUES (?, ?, ?, 0, 1)
     ON CONFLICT(account_id, resource, date) DO UPDATE SET exhausted = 1`
  ).bind(accountId, resource, today).run();
}

export async function clearExhausted(db: D1Database, accountId: number, resource: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  await db.prepare(
    `UPDATE quota_usage SET exhausted = 0 WHERE account_id = ? AND resource = ? AND date = ?`
  ).bind(accountId, resource, today).run();
}

export async function getQuotaTodayByResource(db: D1Database, resource: string): Promise<QuotaUsage[]> {
  const today = new Date().toISOString().split('T')[0];
  const { results } = await db.prepare('SELECT * FROM quota_usage WHERE resource = ? AND date = ?')
    .bind(resource, today).all<QuotaUsage>();
  return results;
}

// ============ Audit log ============

export async function addAuditLog(db: D1Database, data: {
  account_id?: number; action: string; target?: string; detail?: string; status: string;
}): Promise<void> {
  await db.prepare(
    'INSERT INTO audit_log (account_id, action, target, detail, status) VALUES (?, ?, ?, ?, ?)'
  ).bind(data.account_id || null, data.action, data.target || null, data.detail || null, data.status).run();
}

export async function getRecentLogs(db: D1Database, limit = 20): Promise<AuditLogRow[]> {
  const { results } = await db.prepare(
    `SELECT l.*, a.name as account_name FROM audit_log l
     LEFT JOIN accounts a ON l.account_id = a.id
     ORDER BY l.created_at DESC LIMIT ?`
  ).bind(limit).all<AuditLogRow>();
  return results;
}

export interface LogFilter {
  action?: string;
  startDate?: string;  // YYYY-MM-DD
  endDate?: string;    // YYYY-MM-DD
  limit?: number;
}

/** 按条件查询审计日志，支持 action / 日期范围筛选 */
export async function queryLogs(db: D1Database, filter: LogFilter = {}): Promise<AuditLogRow[]> {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filter.action) {
    conditions.push('l.action = ?');
    params.push(filter.action);
  }
  if (filter.startDate) {
    conditions.push('date(l.created_at) >= ?');
    params.push(filter.startDate);
  }
  if (filter.endDate) {
    conditions.push('date(l.created_at) <= ?');
    params.push(filter.endDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit ?? 100;

  const { results } = await db.prepare(
    `SELECT l.*, a.name as account_name FROM audit_log l
     LEFT JOIN accounts a ON l.account_id = a.id
     ${where}
     ORDER BY l.created_at DESC LIMIT ?`
  ).bind(...params, limit).all<AuditLogRow>();
  return results;
}

/** 获取所有不重复的操作类型 */
export async function getDistinctActions(db: D1Database): Promise<string[]> {
  const { results } = await db.prepare(
    'SELECT DISTINCT action FROM audit_log ORDER BY action'
  ).all<{ action: string }>();
  return results.map(r => r.action);
}

// ============ Settings ============

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').bind(key, value).run();
}

// ============ Optimistic tracking (D1 fallback) ============

/** Atomically increment optimistic count for a given account+resource. */
export async function addOptimisticD1(db: D1Database, accountId: number, resource: string, amount: number): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  await db.prepare(
    `INSERT INTO quota_usage (account_id, resource, date, count, optimistic) VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(account_id, resource, date) DO UPDATE SET optimistic = optimistic + ?`
  ).bind(accountId, resource, today, amount, amount).run();
}

/** Clear optimistic for a given account+resource after real usage is recorded. */
export async function clearOptimisticD1(db: D1Database, accountId: number, resource: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  await db.prepare(
    'UPDATE quota_usage SET optimistic = 0 WHERE account_id = ? AND resource = ? AND date = ?'
  ).bind(accountId, resource, today).run();
}

/** Get all optimistic values for a resource, keyed by account_id. */
export async function getOptimisticMapD1(db: D1Database, resource: string): Promise<Map<number, number>> {
  const today = new Date().toISOString().split('T')[0];
  const { results } = await db.prepare(
    'SELECT account_id, optimistic FROM quota_usage WHERE resource = ? AND date = ?'
  ).bind(resource, today).all<{ account_id: number; optimistic: number }>();
  const map = new Map<number, number>();
  for (const r of results) map.set(r.account_id, r.optimistic || 0);
  return map;
}

// ============ Catalog Sources ============

export interface CatalogSource {
  id: number;
  url: string;
  name: string;
  is_default: number;
  enabled: number;
  last_synced: string | null;
  last_status: string;
  last_error: string | null;
  etag: string | null;
  created_at: string;
}

export async function getCatalogSources(db: D1Database): Promise<CatalogSource[]> {
  const { results } = await db.prepare('SELECT * FROM catalog_sources ORDER BY is_default DESC, id ASC').all<CatalogSource>();
  return results;
}

export async function getEnabledCatalogSources(db: D1Database): Promise<CatalogSource[]> {
  const { results } = await db.prepare('SELECT * FROM catalog_sources WHERE enabled = 1 ORDER BY is_default DESC, id ASC').all<CatalogSource>();
  return results;
}

export async function getCatalogSourceById(db: D1Database, id: number): Promise<CatalogSource | null> {
  return db.prepare('SELECT * FROM catalog_sources WHERE id = ?').bind(id).first<CatalogSource>();
}

export async function getDefaultCatalogSource(db: D1Database): Promise<CatalogSource | null> {
  return db.prepare('SELECT * FROM catalog_sources WHERE is_default = 1').first<CatalogSource>();
}

export async function createCatalogSource(db: D1Database, data: {
  url: string; name: string; is_default?: number;
}): Promise<number> {
  const res = await db.prepare(
    'INSERT INTO catalog_sources (url, name, is_default) VALUES (?, ?, ?)'
  ).bind(data.url, data.name, data.is_default || 0).run();
  return res.meta.last_row_id;
}

export async function updateCatalogSource(db: D1Database, id: number, data: Partial<{
  url: string; name: string; enabled: number; last_synced: string;
  last_status: string; last_error: string | null; etag: string | null;
}>): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(val);
    }
  }
  if (sets.length === 0) return;
  vals.push(id);
  await db.prepare(`UPDATE catalog_sources SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
}

export async function deleteCatalogSource(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM catalog_sources WHERE id = ? AND is_default = 0').bind(id).run();
}

export async function ensureDefaultCatalogSource(db: D1Database, url: string, name: string): Promise<void> {
  const existing = await getDefaultCatalogSource(db);
  if (!existing) {
    await db.prepare(
      'INSERT INTO catalog_sources (url, name, is_default) VALUES (?, ?, 1)'
    ).bind(url, name).run();
  } else if (existing.url !== url || existing.name !== name) {
    // 代码常量已变更（如迁移到新仓库），同步修正已存在的默认源地址
    await updateCatalogSource(db, existing.id, { url, name });
  }
}

// ============ Domain Providers ============
// Mirrors backend/src/models/domainProvider.ts — adapted for D1's async API.

export interface DomainProvider {
  id: number;
  code: string;
  name: string;
  api_base_url: string;
  auth_type: string;
  capabilities: string;
  doc_url: string;
  register_url: string;
  promo_url: string;
  regions: string;
  description: string;
  commission_model: string;
  registration_steps: string;
  credential_fields: string;
  is_default: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface DomainProviderAccount {
  id: number;
  provider_id: number;
  name: string;
  api_key: string | null;
  api_secret: string | null;
  api_user: string | null;
  is_active: number;
  last_synced: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export async function getAllProviders(db: D1Database): Promise<DomainProvider[]> {
  const { results } = await db.prepare('SELECT * FROM domain_providers ORDER BY is_default DESC, name ASC').all();
  return results as unknown as DomainProvider[];
}

export async function getProviderById(db: D1Database, id: number): Promise<DomainProvider | null> {
  return await db.prepare('SELECT * FROM domain_providers WHERE id = ?').bind(id).first() as unknown as DomainProvider | null;
}

export async function createProvider(db: D1Database, input: Record<string, any>): Promise<number> {
  const result = await db.prepare(
    `INSERT INTO domain_providers (code, name, api_base_url, auth_type, capabilities, doc_url, register_url, promo_url, regions, description, commission_model, registration_steps, credential_fields, is_default, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    input.code, input.name, input.api_base_url,
    input.auth_type || 'header', input.capabilities || '', input.doc_url || '',
    input.register_url || '', input.promo_url || '', input.regions || 'GLOBAL',
    input.description || '', input.commission_model || '',
    input.registration_steps || '', input.credential_fields || '',
    input.is_default ?? 0, input.enabled ?? 1,
  ).run();
  return Number(result.meta.last_row_id);
}

export async function updateProvider(db: D1Database, id: number, input: Record<string, any>): Promise<void> {
  const fieldMap: Record<string, string> = {
    name: 'name', api_base_url: 'api_base_url', auth_type: 'auth_type',
    capabilities: 'capabilities', doc_url: 'doc_url', register_url: 'register_url',
    promo_url: 'promo_url', regions: 'regions', description: 'description',
    commission_model: 'commission_model', registration_steps: 'registration_steps',
    credential_fields: 'credential_fields', is_default: 'is_default', enabled: 'enabled',
  };
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [key, val] of Object.entries(input)) {
    if (val !== undefined && fieldMap[key]) {
      sets.push(`${fieldMap[key]} = ?`);
      vals.push(val);
    }
  }
  if (sets.length === 0) return;
  sets.push("updated_at = CURRENT_TIMESTAMP");
  vals.push(id);
  await db.prepare(`UPDATE domain_providers SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
}

export async function deleteProvider(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM domain_providers WHERE id = ? AND is_default = 0').bind(id).run();
}

export async function getAccountsByProvider(db: D1Database, providerId: number): Promise<DomainProviderAccount[]> {
  const { results } = await db.prepare('SELECT * FROM domain_provider_accounts WHERE provider_id = ? ORDER BY created_at DESC').bind(providerId).all();
  return results as unknown as DomainProviderAccount[];
}

export async function getProviderAccountById(db: D1Database, id: number): Promise<DomainProviderAccount | null> {
  return await db.prepare('SELECT * FROM domain_provider_accounts WHERE id = ?').bind(id).first() as unknown as DomainProviderAccount | null;
}

export async function getAccountWithProvider(db: D1Database, id: number): Promise<(DomainProviderAccount & { provider_code: string; provider_name: string; api_base_url: string; auth_type: string }) | null> {
  return await db.prepare(`
    SELECT a.*, p.code AS provider_code, p.name AS provider_name, p.api_base_url AS api_base_url, p.auth_type AS auth_type
    FROM domain_provider_accounts a
    JOIN domain_providers p ON p.id = a.provider_id
    WHERE a.id = ?
  `).bind(id).first() as any;
}

export async function createProviderAccount(db: D1Database, providerId: number, input: Record<string, any>, encryptedKey: string, encryptedSecret: string, encryptedUser?: string): Promise<number> {
  const result = await db.prepare(
    `INSERT INTO domain_provider_accounts (provider_id, name, api_key, api_secret, api_user, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    providerId, input.name, encryptedKey,
    encryptedSecret || null, encryptedUser || null,
    input.is_active ?? 1,
  ).run();
  return Number(result.meta.last_row_id);
}

export async function updateProviderAccount(db: D1Database, id: number, fields: Record<string, any>): Promise<void> {
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [key, val] of Object.entries(fields)) {
    if (val === undefined) continue;
    sets.push(`${key} = ?`);
    vals.push(val);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = CURRENT_TIMESTAMP");
  vals.push(id);
  await db.prepare(`UPDATE domain_provider_accounts SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
}

export async function deleteProviderAccount(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM domain_provider_accounts WHERE id = ?').bind(id).run();
}
