import { appLogger } from './logger';
import { DecryptError } from './cfFactory';
import { decrypt } from './encryptionService';
import type { DomainProviderAccount } from '../models/domainProvider';

/**
 * Thin client around the DNSHE free-domain API (V2.0).
 *
 * API shape (per the official V2.0 docs):
 *   Base URL pattern:  <api_base_url>?m=domain_hub&endpoint=<endpoint>&action=<action>
 *   Auth:              HTTP headers X-API-Key + X-API-Secret
 *   Format:            JSON
 *   Rate limit:        60 req/min (provider may return `rate_limit_exceeded`)
 *
 * Every method here:
 *   - decrypts the stored credentials on the fly (so rotating ENCRYPTION_KEY
 *     without re-encrypting the DB raises a typed DecryptError the route can
 *     translate into the same actionable UI we use for CF accounts),
 *   - normalises DNSHE's error envelope into a thrown Error with a stable
 *     `code` property so the route layer doesn't have to special-case the
 *     upstream JSON shape.
 */

const DNSHE_ERROR_CODES = new Set([
  'bad_request',
  'auth_invalid_credentials',
  'auth_ip_not_allowed',
  'api_access_disabled',
  'not_found',
  'subdomain_not_found',
  'dns_record_not_found',
  'quota_exceeded',
  'rate_limit_exceeded',
  'provider_operation_failed',
  'internal_error',
  'renewal_not_yet_available',
]);

export class DnsheApiError extends Error {
  code: string;
  httpStatus: number;
  details?: any;
  constructor(code: string, message: string, httpStatus: number, details?: any) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    this.name = 'DnsheApiError';
  }
}

interface DnsheConfig {
  apiBaseUrl: string;
  apiKey: string;       // plaintext (decrypted by caller)
  apiSecret: string;    // plaintext (decrypted by caller)
  apiUser?: string;     // plaintext (decrypted by caller) — Namecheap ApiUser
  providerCode: string; // dispatched in buildConfig; lets future per-provider adapters branch
}

/** Decrypt the stored encrypted credentials of a provider account. */
export function decryptProviderAccountCreds(account: DomainProviderAccount): { apiKey: string; apiSecret: string; apiUser: string } {
  try {
    return {
      apiKey: account.api_key ? decrypt(account.api_key) : '',
      apiSecret: account.api_secret ? decrypt(account.api_secret) : '',
      apiUser: account.api_user ? decrypt(account.api_user) : '',
    };
  } catch (e) {
    throw new DecryptError(account.id, e);
  }
}

async function dnsheRequest<T = any>(cfg: DnsheConfig, endpoint: string, action: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: any): Promise<T> {
  const url = new URL(cfg.apiBaseUrl);
  url.searchParams.set('m', 'domain_hub');
  url.searchParams.set('endpoint', endpoint);
  if (action) url.searchParams.set('action', action);

  const init: RequestInit = {
    method,
    headers: {
      'X-API-Key': cfg.apiKey,
      'X-API-Secret': cfg.apiSecret,
      'Content-Type': 'application/json',
    },
  };
  if (body !== undefined && method !== 'GET') {
    init.body = JSON.stringify(body);
  }

  let resp: Response;
  try {
    resp = await fetch(url.toString(), init);
  } catch (e: any) {
    throw new DnsheApiError('network_error', `DNSHE 网络请求失败: ${e?.message || e}`, 0);
  }

  let json: any;
  try {
    json = await resp.json();
  } catch {
    const text = await resp.text().catch(() => '');
    throw new DnsheApiError('invalid_response', `DNSHE 返回非 JSON 响应 (HTTP ${resp.status}): ${text.slice(0, 200)}`, resp.status);
  }

  if (json && json.success === false) {
    const code: string = json.error_code || 'unknown_error';
    const message: string = json.message || json.error || 'DNSHE API 返回错误';
    throw new DnsheApiError(DNSHE_ERROR_CODES.has(code) ? code : 'unknown_error', message, resp.status, json.details);
  }

  if (!resp.ok && !(json && json.success === true)) {
    throw new DnsheApiError('http_error', `DNSHE HTTP ${resp.status}: ${JSON.stringify(json).slice(0, 200)}`, resp.status);
  }

  return json as T;
}

// ===== Subdomains =====

export interface DnsheSubdomain {
  id: number;
  subdomain: string;
  rootdomain: string;
  full_domain: string;
  status: 'active' | 'suspended' | 'expired' | string;
  created_at?: string;
  updated_at?: string;
  expires_at?: string | null;
  never_expires?: number | boolean;
  cloudflare_zone_id?: string | null;
  provider_account_id?: string | null;
}

export async function listSubdomains(cfg: DnsheConfig, opts: { page?: number; per_page?: number; search?: string; status?: string } = {}): Promise<{ subdomains: DnsheSubdomain[]; pagination?: any; count: number }> {
  const params: Record<string, any> = { page: opts.page ?? 1, per_page: opts.per_page ?? 200 };
  if (opts.search) params.search = opts.search;
  if (opts.status) params.status = opts.status;
  // GET — encode as query params
  const url = new URL(cfg.apiBaseUrl);
  url.searchParams.set('m', 'domain_hub');
  url.searchParams.set('endpoint', 'subdomains');
  url.searchParams.set('action', 'list');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'X-API-Key': cfg.apiKey, 'X-API-Secret': cfg.apiSecret, 'Content-Type': 'application/json' },
  });
  const json: any = await resp.json().catch(() => ({}));
  if (json?.success === false) {
    throw new DnsheApiError(json.error_code || 'unknown_error', json.message || json.error || 'DNSHE list 失败', resp.status, json.details);
  }
  return { subdomains: json.subdomains || [], pagination: json.pagination, count: json.count ?? (json.subdomains?.length || 0) };
}

export async function getSubdomainDetails(cfg: DnsheConfig, subdomainId: number): Promise<any> {
  return dnsheRequest(cfg, 'subdomains', 'get', 'GET', undefined).then(() => {
    // GET method but DNSHE expects subdomain_id as query param; need to construct manually
    return null;
  });
}

// `get` action takes subdomain_id as a query param
export async function getSubdomain(cfg: DnsheConfig, subdomainId: number): Promise<any> {
  const url = new URL(cfg.apiBaseUrl);
  url.searchParams.set('m', 'domain_hub');
  url.searchParams.set('endpoint', 'subdomains');
  url.searchParams.set('action', 'get');
  url.searchParams.set('subdomain_id', String(subdomainId));
  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'X-API-Key': cfg.apiKey, 'X-API-Secret': cfg.apiSecret, 'Content-Type': 'application/json' },
  });
  const json: any = await resp.json().catch(() => ({}));
  if (json?.success === false) {
    throw new DnsheApiError(json.error_code || 'unknown_error', json.message || json.error || 'DNSHE get 失败', resp.status, json.details);
  }
  return json;
}

export async function registerSubdomain(cfg: DnsheConfig, subdomain: string, rootdomain: string): Promise<any> {
  return dnsheRequest(cfg, 'subdomains', 'register', 'POST', { subdomain, rootdomain });
}

export async function deleteSubdomain(cfg: DnsheConfig, subdomainId: number): Promise<any> {
  return dnsheRequest(cfg, 'subdomains', 'delete', 'POST', { subdomain_id: subdomainId });
}

export async function renewSubdomain(cfg: DnsheConfig, subdomainId: number): Promise<any> {
  return dnsheRequest(cfg, 'subdomains', 'renew', 'POST', { subdomain_id: subdomainId });
}

// ===== DNS Records =====

export interface DnsheDnsRecord {
  id: number;
  record_id?: string;
  name: string;
  type: string;
  content: string;
  ttl: number;
  priority?: number | null;
  line?: string | null;
  proxied?: boolean;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export async function listDnsRecords(cfg: DnsheConfig, subdomainId: number): Promise<DnsheDnsRecord[]> {
  const url = new URL(cfg.apiBaseUrl);
  url.searchParams.set('m', 'domain_hub');
  url.searchParams.set('endpoint', 'dns_records');
  url.searchParams.set('action', 'list');
  url.searchParams.set('subdomain_id', String(subdomainId));
  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'X-API-Key': cfg.apiKey, 'X-API-Secret': cfg.apiSecret, 'Content-Type': 'application/json' },
  });
  const json: any = await resp.json().catch(() => ({}));
  if (json?.success === false) {
    throw new DnsheApiError(json.error_code || 'unknown_error', json.message || json.error || 'DNSHE DNS list 失败', resp.status, json.details);
  }
  return json.records || [];
}

export async function createDnsRecord(cfg: DnsheConfig, params: { subdomain_id: number; type: string; name?: string; content: string; ttl?: number; priority?: number; line?: string; }): Promise<any> {
  return dnsheRequest(cfg, 'dns_records', 'create', 'POST', params);
}

export async function updateDnsRecord(cfg: DnsheConfig, params: { id?: number; record_id?: string; type?: string; name?: string; content?: string; ttl?: number; priority?: number; line?: string; }): Promise<any> {
  return dnsheRequest(cfg, 'dns_records', 'update', 'POST', params);
}

export async function deleteDnsRecord(cfg: DnsheConfig, params: { id?: number; record_id?: string }): Promise<any> {
  return dnsheRequest(cfg, 'dns_records', 'delete', 'POST', params);
}

// ===== API Keys (provider-side) =====

export async function listApiKeys(cfg: DnsheConfig): Promise<any> {
  const url = new URL(cfg.apiBaseUrl);
  url.searchParams.set('m', 'domain_hub');
  url.searchParams.set('endpoint', 'keys');
  url.searchParams.set('action', 'list');
  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'X-API-Key': cfg.apiKey, 'X-API-Secret': cfg.apiSecret, 'Content-Type': 'application/json' },
  });
  const json: any = await resp.json().catch(() => ({}));
  if (json?.success === false) {
    throw new DnsheApiError(json.error_code || 'unknown_error', json.message || json.error || 'DNSHE keys list 失败', resp.status, json.details);
  }
  return json;
}

// ===== Quota =====

export async function getQuota(cfg: DnsheConfig): Promise<any> {
  const url = new URL(cfg.apiBaseUrl);
  url.searchParams.set('m', 'domain_hub');
  url.searchParams.set('endpoint', 'quota');
  const resp = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'X-API-Key': cfg.apiKey, 'X-API-Secret': cfg.apiSecret, 'Content-Type': 'application/json' },
  });
  const json: any = await resp.json().catch(() => ({}));
  if (json?.success === false) {
    throw new DnsheApiError(json.error_code || 'unknown_error', json.message || json.error || 'DNSHE quota 失败', resp.status, json.details);
  }
  return json;
}

/**
 * Lightweight connection probe — used by the "test" button in the UI.
 * Calls the quota endpoint because it's the cheapest authenticated call
 * (no list payload). Returns the quota + the upstream API key name if
 * available so the user gets visual confirmation the credentials work.
 */
export async function testConnection(cfg: DnsheConfig): Promise<{ ok: true; quota: any }> {
  const quota = await getQuota(cfg);
  return { ok: true, quota };
}

/**
 * Dispatch helper: given a provider code + decrypted credentials, build the
 * DnsheConfig used by the API methods above. Today only 'dnshe' has a live
 * API implementation; other registered providers (porkbun, namecheap, ...)
 * throw `provider_not_implemented` so the UI can show a clear "coming soon"
 * message and the user can still manage their stored credentials.
 */
export function buildConfig(providerCode: string, apiBaseUrl: string, apiKey: string, apiSecret: string, apiUser?: string): DnsheConfig {
  const KNOWN_PROVIDERS = new Set(['dnshe', 'porkbun', 'namesilo', 'namecheap', 'godaddy', 'dynadot', 'aliyun', 'tencent', 'cloudflare']);
  if (!KNOWN_PROVIDERS.has(providerCode)) {
    throw new DnsheApiError('provider_unknown', `未知域名提供商 "${providerCode}"`, 400);
  }
  // Live API adapter is implemented for DNSHE only. Other providers can be
  // registered as accounts and the credentials are safely stored, but live
  // domain/DNS calls return a typed not-implemented error. This keeps the
  // registry forward-compatible with future adapters.
  if (providerCode !== 'dnshe') {
    throw new DnsheApiError(
      'provider_not_implemented',
      `域名提供商 "${providerCode}" 的 API 适配尚未实现，仅 DNSHE 可调用实时接口。已保存的凭证不会丢失，待适配完成后即可使用。`,
      501,
    );
  }
  return { apiBaseUrl, apiKey, apiSecret, apiUser, providerCode };
}

export function logDnsheError(accountId: number, accountName: string, err: unknown): void {
  if (err instanceof DnsheApiError) {
    appLogger.error(`[DNSHE] account ${accountName} (${accountId}) [${err.code}] HTTP ${err.httpStatus}: ${err.message}${err.details ? ' details=' + JSON.stringify(err.details) : ''}`);
  } else {
    appLogger.error(`[DNSHE] account ${accountName} (${accountId}): ${err}`);
  }
}
