import apiClient from './client';

export interface RegistrationStep {
  title: string;
  detail: string;
}
export interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'password';
  required: boolean;
  placeholder: string;
  help?: string;
}
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
  registration_steps: string;          // JSON string of RegistrationStep[]
  credential_fields: string;          // JSON string of CredentialField[]
  is_default: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

/** Parse the registration_steps JSON column into a typed array. */
export function parseRegistrationSteps(json: string): RegistrationStep[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/** Parse the credential_fields JSON column into a typed array. */
export function parseCredentialFields(json: string): CredentialField[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
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

export interface DnsheQuota {
  used: number;
  base: number;
  invite_bonus: number;
  total: number;
  available: number;
}

export const domainProvidersApi = {
  // Providers
  listProviders: () => apiClient.get('/domain-providers'),
  createProvider: (data: Partial<DomainProvider>) => apiClient.post('/domain-providers', data),
  updateProvider: (id: number, data: Partial<DomainProvider>) => apiClient.put(`/domain-providers/${id}`, data),
  deleteProvider: (id: number) => apiClient.delete(`/domain-providers/${id}`),

  // Accounts under a provider
  listAccounts: (providerId: number) => apiClient.get(`/domain-providers/${providerId}/accounts`),
  createAccount: (providerId: number, data: { name: string; api_key: string; api_secret?: string; api_user?: string; is_active?: number }) =>
    apiClient.post(`/domain-providers/${providerId}/accounts`, data),
  updateAccount: (id: number, data: Partial<{ name: string; api_key: string; api_secret: string; api_user: string; is_active: number }>) =>
    apiClient.put(`/domain-providers/accounts/${id}`, data),
  deleteAccount: (id: number) => apiClient.delete(`/domain-providers/accounts/${id}`),
  testAccount: (id: number) => apiClient.post(`/domain-providers/accounts/${id}/test`, {}, { timeout: 30000 }),

  // Subdomains
  listSubdomains: (id: number, params?: { search?: string; status?: string; page?: number; per_page?: number }) =>
    apiClient.get(`/domain-providers/accounts/${id}/subdomains`, { params }),
  registerSubdomain: (id: number, data: { subdomain: string; rootdomain: string }) =>
    apiClient.post(`/domain-providers/accounts/${id}/subdomains`, data),
  deleteSubdomain: (id: number, subId: number) =>
    apiClient.delete(`/domain-providers/accounts/${id}/subdomains/${subId}`),
  renewSubdomain: (id: number, subId: number) =>
    apiClient.post(`/domain-providers/accounts/${id}/subdomains/${subId}/renew`),
  getSubdomain: (id: number, subId: number) =>
    apiClient.get(`/domain-providers/accounts/${id}/subdomains/${subId}`),

  // DNS records
  listDnsRecords: (id: number, subId: number) =>
    apiClient.get(`/domain-providers/accounts/${id}/subdomains/${subId}/dns-records`),
  createDnsRecord: (id: number, subId: number, data: { type: string; name?: string; content: string; ttl?: number; priority?: number; line?: string }) =>
    apiClient.post(`/domain-providers/accounts/${id}/subdomains/${subId}/dns-records`, data),
  updateDnsRecord: (id: number, subId: number, recId: number | string, data: any) =>
    apiClient.put(`/domain-providers/accounts/${id}/subdomains/${subId}/dns-records/${recId}`, data),
  deleteDnsRecord: (id: number, subId: number, recId: number | string) =>
    apiClient.delete(`/domain-providers/accounts/${id}/subdomains/${subId}/dns-records/${recId}`),

  // Quota & API keys
  getQuota: (id: number) => apiClient.get(`/domain-providers/accounts/${id}/quota`),
  listApiKeys: (id: number) => apiClient.get(`/domain-providers/accounts/${id}/api-keys`),
};
