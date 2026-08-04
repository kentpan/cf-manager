import { getDb } from '../db';

/**
 * Models for the free-domain provider registry + per-provider API credentials.
 *
 * Two tables (defined in db.ts):
 *   domain_providers           — describes HOW to talk to a registrar
 *                                (code, api_base_url, promo_url, ...)
 *   domain_provider_accounts   — per-account credentials for a provider
 *                                (api_key/api_secret, AES-encrypted via
 *                                encryptionService like CF accounts)
 *
 * The Cloudflare-account analogy:
 *   domain_providers         ~= a class of integration ("CF")
 *   domain_provider_accounts ~= a single CF account (api token + id)
 *
 * For now only the DNSHE provider (code='dnshe') has a service implementation
 * in services/dnsheService.ts; other providers can be registered but their
 * live endpoints will return "not implemented" until a matching service is
 * added. The data model is generic so adding new providers is just (table
 * row + service file + dispatch entry).
 */

export interface DomainProvider {
  id: number;
  code: string;
  name: string;
  api_base_url: string;
  auth_type: 'header' | 'bearer' | 'query' | 'basic';
  capabilities: string;
  doc_url: string;
  register_url: string;
  promo_url: string;
  regions: string;
  description: string;
  commission_model: string;
  registration_steps: string;          // JSON array of {title, detail} — parsed by the API layer
  credential_fields: string;          // JSON array of {key,label,type,required,placeholder,help}
  is_default: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface DomainProviderInput {
  code: string;
  name: string;
  api_base_url: string;
  auth_type?: 'header' | 'bearer' | 'query' | 'basic';
  capabilities?: string;
  doc_url?: string;
  register_url?: string;
  promo_url?: string;
  regions?: string;
  description?: string;
  commission_model?: string;
  registration_steps?: string;
  credential_fields?: string;
  is_default?: number;
  enabled?: number;
}

export interface DomainProviderAccount {
  id: number;
  provider_id: number;
  name: string;
  api_key: string | null;        // stored encrypted; service layer decrypts on use
  api_secret: string | null;     // stored encrypted
  api_user: string | null;       // stored encrypted — third field (e.g. Namecheap ApiUser)
  is_active: number;
  last_synced: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DomainProviderAccountInput {
  name: string;
  api_key: string;     // plaintext at input layer — encrypted before storage
  api_secret?: string;  // plaintext at input layer — encrypted before storage
  api_user?: string;    // plaintext at input layer — encrypted before storage (Namecheap)
  is_active?: number;
}

// ===== Providers =====

export function getAllProviders(): DomainProvider[] {
  return getDb().prepare('SELECT * FROM domain_providers ORDER BY is_default DESC, name ASC').all() as DomainProvider[];
}

export function getProviderById(id: number): DomainProvider | undefined {
  return getDb().prepare('SELECT * FROM domain_providers WHERE id = ?').get(id) as DomainProvider | undefined;
}

export function getProviderByCode(code: string): DomainProvider | undefined {
  return getDb().prepare('SELECT * FROM domain_providers WHERE code = ?').get(code) as DomainProvider | undefined;
}

export function createProvider(input: DomainProviderInput): number {
  const result = getDb().prepare(
    `INSERT INTO domain_providers
      (code, name, api_base_url, auth_type, capabilities, doc_url, register_url,
       promo_url, regions, description, commission_model, registration_steps,
       credential_fields, is_default, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.code,
    input.name,
    input.api_base_url,
    input.auth_type || 'header',
    input.capabilities || '',
    input.doc_url || '',
    input.register_url || '',
    input.promo_url || '',
    input.regions || 'GLOBAL',
    input.description || '',
    input.commission_model || '',
    input.registration_steps || '',
    input.credential_fields || '',
    input.is_default ?? 0,
    input.enabled ?? 1,
  );
  return result.lastInsertRowid as number;
}

export function updateProvider(id: number, input: Partial<DomainProviderInput>): void {
  const sets: string[] = [];
  const vals: any[] = [];
  const fieldMap: Record<string, string> = {
    code: 'code',
    name: 'name',
    api_base_url: 'api_base_url',
    auth_type: 'auth_type',
    capabilities: 'capabilities',
    doc_url: 'doc_url',
    register_url: 'register_url',
    promo_url: 'promo_url',
    regions: 'regions',
    description: 'description',
    commission_model: 'commission_model',
    registration_steps: 'registration_steps',
    credential_fields: 'credential_fields',
    is_default: 'is_default',
    enabled: 'enabled',
  };
  for (const [key, val] of Object.entries(input)) {
    if (val !== undefined && fieldMap[key]) {
      sets.push(`${fieldMap[key]} = ?`);
      vals.push(val);
    }
  }
  if (sets.length === 0) return;
  sets.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(id);
  getDb().prepare(`UPDATE domain_providers SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function deleteProvider(id: number): void {
  getDb().prepare('DELETE FROM domain_providers WHERE id = ?').run(id);
}

// ===== Provider accounts =====

export function getAccountsByProvider(providerId: number): DomainProviderAccount[] {
  return getDb()
    .prepare('SELECT * FROM domain_provider_accounts WHERE provider_id = ? ORDER BY created_at DESC')
    .all(providerId) as DomainProviderAccount[];
}

export function getAllProviderAccounts(): Array<DomainProviderAccount & { provider_code: string; provider_name: string }> {
  return getDb()
    .prepare(`
      SELECT a.*, p.code AS provider_code, p.name AS provider_name
      FROM domain_provider_accounts a
      JOIN domain_providers p ON p.id = a.provider_id
      ORDER BY a.created_at DESC
    `)
    .all() as Array<DomainProviderAccount & { provider_code: string; provider_name: string }>;
}

export function getAccountById(id: number): DomainProviderAccount | undefined {
  return getDb().prepare('SELECT * FROM domain_provider_accounts WHERE id = ?').get(id) as DomainProviderAccount | undefined;
}

export function getAccountWithProvider(id: number): (DomainProviderAccount & { provider_code: string; provider_name: string; api_base_url: string; auth_type: string }) | undefined {
  return getDb()
    .prepare(`
      SELECT a.*, p.code AS provider_code, p.name AS provider_name, p.api_base_url AS api_base_url, p.auth_type AS auth_type
      FROM domain_provider_accounts a
      JOIN domain_providers p ON p.id = a.provider_id
      WHERE a.id = ?
    `)
    .get(id) as (DomainProviderAccount & { provider_code: string; provider_name: string; api_base_url: string; auth_type: string }) | undefined;
}

export function createProviderAccount(
  providerId: number,
  input: DomainProviderAccountInput,
  encryptedKey: string,
  encryptedSecret: string,
  encryptedUser?: string,
): number {
  const result = getDb().prepare(
    `INSERT INTO domain_provider_accounts (provider_id, name, api_key, api_secret, api_user, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    providerId,
    input.name,
    encryptedKey,
    encryptedSecret || null,
    encryptedUser || null,
    input.is_active ?? 1,
  );
  return result.lastInsertRowid as number;
}

export function updateProviderAccount(id: number, fields: Partial<{ name: string; api_key: string; api_secret: string; api_user: string; is_active: number; last_synced: string; last_error: string | null }>): void {
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [key, val] of Object.entries(fields)) {
    if (val === undefined) continue;
    sets.push(`${key} = ?`);
    vals.push(val);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(id);
  getDb().prepare(`UPDATE domain_provider_accounts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function deleteProviderAccount(id: number): void {
  getDb().prepare('DELETE FROM domain_provider_accounts WHERE id = ?').run(id);
}
