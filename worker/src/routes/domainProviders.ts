import { Hono } from 'hono';
import type { Env } from '../types';
import {
  getAllProviders, getProviderById, createProvider, updateProvider, deleteProvider,
  getAccountsByProvider, getAccountById, getAccountWithProvider,
  createProviderAccount, updateProviderAccount, deleteProviderAccount,
} from '../db/models';
import { getAuthHeaders, cfFetch } from '../services/cfApi';
import type { Account } from '../db/models';

const app = new Hono<{ Bindings: Env }>();

function maskCreds(a: any) {
  return {
    ...a,
    api_key: a.api_key ? '***encrypted***' : null,
    api_secret: a.api_secret ? '***encrypted***' : null,
    api_user: a.api_user ? '***encrypted***' : null,
  };
}

// ============ Provider CRUD ============

app.get('/', async (c) => {
  const providers = await getAllProviders(c.env.DB);
  return c.json({ providers });
});

app.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { code, name, api_base_url, auth_type, capabilities, doc_url, register_url, promo_url, regions, description, commission_model, registration_steps, credential_fields, is_default, enabled } = body || {};
  if (!code || !name || !api_base_url) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'code, name, api_base_url 必填' } }, 400);
  }
  const id = await createProvider(c.env.DB, {
    code, name, api_base_url,
    auth_type: auth_type || 'header',
    capabilities: capabilities || '',
    doc_url: doc_url || '',
    register_url: register_url || '',
    promo_url: promo_url || '',
    regions: regions || 'GLOBAL',
    description: description || '',
    commission_model: commission_model || '',
    registration_steps: registration_steps || '',
    credential_fields: credential_fields || '',
    is_default: is_default ?? 0,
    enabled: enabled ?? 1,
  });
  return c.json({ id, code, name, api_base_url }, 201);
});

app.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const existing = await getProviderById(c.env.DB, id);
  if (!existing) {
    return c.json({ error: { code: 'NOT_FOUND', message: '域名提供商不存在' } }, 404);
  }
  const body = await c.req.json().catch(() => ({}));
  await updateProvider(c.env.DB, id, body || {});
  return c.json({ success: true });
});

app.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const provider = await getProviderById(c.env.DB, id);
  if (!provider) {
    return c.json({ error: { code: 'NOT_FOUND', message: '域名提供商不存在' } }, 404);
  }
  if (provider.is_default) {
    return c.json({ error: { code: 'DEFAULT_PROVIDER', message: '内置默认提供商不可删除，可编辑或禁用' } }, 400);
  }
  await deleteProvider(c.env.DB, id);
  return c.json({ success: true });
});

// ============ Accounts under a provider ============

app.get('/:providerId/accounts', async (c) => {
  const providerId = parseInt(c.req.param('providerId'), 10);
  const provider = await getProviderById(c.env.DB, providerId);
  if (!provider) {
    return c.json({ error: { code: 'NOT_FOUND', message: '域名提供商不存在' } }, 404);
  }
  const accounts = await getAccountsByProvider(c.env.DB, providerId);
  return c.json({ accounts: accounts.map(maskCreds) });
});

app.post('/:providerId/accounts', async (c) => {
  const providerId = parseInt(c.req.param('providerId'), 10);
  const provider = await getProviderById(c.env.DB, providerId);
  if (!provider) {
    return c.json({ error: { code: 'NOT_FOUND', message: '域名提供商不存在' } }, 404);
  }
  const { name, api_key, api_secret, api_user, is_active } = await c.req.json().catch(() => ({}));
  if (!name || !api_key) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'name, api_key 必填' } }, 400);
  }
  const { encrypt } = await import('../services/encryption');
  const encKey = c.env.ENCRYPTION_KEY;
  const id = await createProviderAccount(c.env.DB, providerId, { name, api_key, api_secret, api_user, is_active }, await encrypt(api_key, encKey), api_secret ? await encrypt(api_secret, encKey) : '', api_user ? await encrypt(api_user, encKey) : '');
  return c.json({ id, provider_id: providerId, name, is_active: is_active ?? 1, api_key: '***', api_secret: '***', api_user: '***' }, 201);
});

app.put('/accounts/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const existing = await getAccountById(c.env.DB, id);
  if (!existing) {
    return c.json({ error: { code: 'NOT_FOUND', message: '账号不存在' } }, 404);
  }
  const { name, api_key, api_secret, api_user, is_active } = await c.req.json().catch(() => ({}));
  const updates: any = {};
  if (name !== undefined) updates.name = name;
  if (is_active !== undefined) updates.is_active = is_active;
  const { encrypt } = await import('../services/encryption');
  const encKey = c.env.ENCRYPTION_KEY;
  if (api_key) updates.api_key = await encrypt(api_key, encKey);
  if (api_secret) updates.api_secret = await encrypt(api_secret, encKey);
  if (api_user) updates.api_user = await encrypt(api_user, encKey);
  await updateProviderAccount(c.env.DB, id, updates);
  return c.json({ success: true });
});

app.delete('/accounts/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!await getAccountById(c.env.DB, id)) {
    return c.json({ error: { code: 'NOT_FOUND', message: '账号不存在' } }, 404);
  }
  await deleteProviderAccount(c.env.DB, id);
  return c.json({ success: true });
});

// Helper: load account + decrypt creds
async function loadDnsheConfig(env: Env, accountId: number) {
  const acc = await getAccountWithProvider(env.DB, accountId);
  if (!acc) throw new Error(`账号 #${accountId} 不存在`);
  const { decrypt } = await import('../services/encryption');
  const encKey = env.ENCRYPTION_KEY;
  const apiKey = acc.api_key ? await decrypt(acc.api_key, encKey) : '';
  const apiSecret = acc.api_secret ? await decrypt(acc.api_secret, encKey) : '';
  const apiUser = acc.api_user ? await decrypt(acc.api_user, encKey) : '';
  return { acc, apiKey, apiSecret, apiUser };
}

// ============ Account: connection test ============
app.post('/accounts/:id/test', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  try {
    const { acc, apiKey, apiSecret } = await loadDnsheConfig(c.env, id);
    if (acc.provider_code !== 'dnshe') {
      return c.json({ error: { code: 'provider_not_implemented', message: `域名提供商 "${acc.provider_code}" 的 API 适配尚未实现，仅 DNSHE 可调用实时接口。` } }, 400);
    }
    // Test by calling the quota endpoint
    const baseUrl = acc.api_base_url;
    const url = new URL(baseUrl);
    url.searchParams.set('m', 'domain_hub');
    url.searchParams.set('endpoint', 'quota');
    const resp = await fetch(url.toString(), {
      headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret, 'Content-Type': 'application/json' },
    });
    const json: any = await resp.json().catch(() => ({}));
    if (json?.success === false) {
      await updateProviderAccount(c.env.DB, id, { last_error: `${json.error_code || 'unknown'}: ${json.message || json.error || ''}` });
      return c.json({ error: { code: json.error_code || 'unknown_error', message: json.message || json.error || 'DNSHE API 返回错误' } }, 400);
    }
    await updateProviderAccount(c.env.DB, id, { last_synced: new Date().toISOString().replace('T', ' ').substring(0, 19), last_error: null });
    return c.json({ success: true, quota: json?.quota || json });
  } catch (e: any) {
    await updateProviderAccount(c.env.DB, id, { last_error: e?.message || String(e) }).catch(() => {});
    return c.json({ error: { code: 'TEST_FAILED', message: e?.message || '测试失败' } }, 400);
  }
});

// ============ Subdomains ============

app.get('/accounts/:id/subdomains', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  try {
    const { acc, apiKey, apiSecret } = await loadDnsheConfig(c.env, id);
    if (acc.provider_code !== 'dnshe') {
      return c.json({ error: { code: 'provider_not_implemented', message: `仅支持 dnshe` } }, 400);
    }
    const url = new URL(acc.api_base_url);
    url.searchParams.set('m', 'domain_hub');
    url.searchParams.set('endpoint', 'subdomains');
    url.searchParams.set('action', 'list');
    const search = c.req.query('search');
    const status = c.req.query('status');
    if (search) url.searchParams.set('search', search);
    if (status) url.searchParams.set('status', status);
    const resp = await fetch(url.toString(), {
      headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret, 'Content-Type': 'application/json' },
    });
    const json: any = await resp.json().catch(() => ({}));
    if (json?.success === false) {
      return c.json({ error: { code: json.error_code || 'unknown_error', message: json.message || json.error || 'DNSHE list 失败' } }, 400);
    }
    return c.json({ account_id: id, account_name: acc.provider_name, subdomains: json.subdomains || [], pagination: json.pagination, count: json.count ?? (json.subdomains?.length || 0) });
  } catch (e: any) {
    return c.json({ error: { code: 'REQUEST_ERROR', message: e?.message || String(e) } }, 400);
  }
});

app.post('/accounts/:id/subdomains', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  try {
    const { acc, apiKey, apiSecret } = await loadDnsheConfig(c.env, id);
    if (acc.provider_code !== 'dnshe') {
      return c.json({ error: { code: 'provider_not_implemented', message: `仅支持 dnshe` } }, 400);
    }
    const { subdomain, rootdomain } = await c.req.json().catch(() => ({}));
    if (!subdomain || !rootdomain) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'subdomain, rootdomain 必填' } }, 400);
    }
    const url = new URL(acc.api_base_url);
    url.searchParams.set('m', 'domain_hub');
    url.searchParams.set('endpoint', 'subdomains');
    url.searchParams.set('action', 'register');
    const resp = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subdomain, rootdomain }),
    });
    const json: any = await resp.json().catch(() => ({}));
    if (json?.success === false) {
      return c.json({ error: { code: json.error_code || 'unknown_error', message: json.message || json.error || 'DNSHE register 失败' } }, 400);
    }
    return c.json(json, 201);
  } catch (e: any) {
    return c.json({ error: { code: 'REQUEST_ERROR', message: e?.message || String(e) } }, 400);
  }
});

app.delete('/accounts/:id/subdomains/:subId', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const subId = parseInt(c.req.param('subId'), 10);
  try {
    const { acc, apiKey, apiSecret } = await loadDnsheConfig(c.env, id);
    if (acc.provider_code !== 'dnshe') {
      return c.json({ error: { code: 'provider_not_implemented', message: `仅支持 dnshe` } }, 400);
    }
    const url = new URL(acc.api_base_url);
    url.searchParams.set('m', 'domain_hub');
    url.searchParams.set('endpoint', 'subdomains');
    url.searchParams.set('action', 'delete');
    const resp = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subdomain_id: subId }),
    });
    const json: any = await resp.json().catch(() => ({}));
    if (json?.success === false) {
      return c.json({ error: { code: json.error_code || 'unknown_error', message: json.message || json.error || 'DNSHE delete 失败' } }, 400);
    }
    return c.json(json);
  } catch (e: any) {
    return c.json({ error: { code: 'REQUEST_ERROR', message: e?.message || String(e) } }, 400);
  }
});

app.post('/accounts/:id/subdomains/:subId/renew', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const subId = parseInt(c.req.param('subId'), 10);
  try {
    const { acc, apiKey, apiSecret } = await loadDnsheConfig(c.env, id);
    if (acc.provider_code !== 'dnshe') {
      return c.json({ error: { code: 'provider_not_implemented', message: `仅支持 dnshe` } }, 400);
    }
    const url = new URL(acc.api_base_url);
    url.searchParams.set('m', 'domain_hub');
    url.searchParams.set('endpoint', 'subdomains');
    url.searchParams.set('action', 'renew');
    const resp = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subdomain_id: subId }),
    });
    const json: any = await resp.json().catch(() => ({}));
    if (json?.success === false) {
      return c.json({ error: { code: json.error_code || 'unknown_error', message: json.message || json.error || 'DNSHE renew 失败' } }, 400);
    }
    return c.json(json);
  } catch (e: any) {
    return c.json({ error: { code: 'REQUEST_ERROR', message: e?.message || String(e) } }, 400);
  }
});

// ============ DNS Records ============

app.get('/accounts/:id/subdomains/:subId/dns-records', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const subId = parseInt(c.req.param('subId'), 10);
  try {
    const { acc, apiKey, apiSecret } = await loadDnsheConfig(c.env, id);
    if (acc.provider_code !== 'dnshe') {
      return c.json({ error: { code: 'provider_not_implemented', message: `仅支持 dnshe` } }, 400);
    }
    const url = new URL(acc.api_base_url);
    url.searchParams.set('m', 'domain_hub');
    url.searchParams.set('endpoint', 'dns_records');
    url.searchParams.set('action', 'list');
    url.searchParams.set('subdomain_id', String(subId));
    const resp = await fetch(url.toString(), {
      headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret, 'Content-Type': 'application/json' },
    });
    const json: any = await resp.json().catch(() => ({}));
    if (json?.success === false) {
      return c.json({ error: { code: json.error_code || 'unknown_error', message: json.message || json.error || 'DNSHE DNS list 失败' } }, 400);
    }
    return c.json({ account_id: id, account_name: acc.provider_name, records: json.records || [] });
  } catch (e: any) {
    return c.json({ error: { code: 'REQUEST_ERROR', message: e?.message || String(e) } }, 400);
  }
});

app.post('/accounts/:id/subdomains/:subId/dns-records', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const subId = parseInt(c.req.param('subId'), 10);
  try {
    const { acc, apiKey, apiSecret } = await loadDnsheConfig(c.env, id);
    if (acc.provider_code !== 'dnshe') {
      return c.json({ error: { code: 'provider_not_implemented', message: `仅支持 dnshe` } }, 400);
    }
    const { type, name, content, ttl, priority, line } = await c.req.json().catch(() => ({}));
    if (!type || !content) {
      return c.json({ error: { code: 'VALIDATION_ERROR', message: 'type, content 必填' } }, 400);
    }
    const url = new URL(acc.api_base_url);
    url.searchParams.set('m', 'domain_hub');
    url.searchParams.set('endpoint', 'dns_records');
    url.searchParams.set('action', 'create');
    const resp = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subdomain_id: subId, type, name, content, ttl, priority, line }),
    });
    const json: any = await resp.json().catch(() => ({}));
    if (json?.success === false) {
      return c.json({ error: { code: json.error_code || 'unknown_error', message: json.message || json.error || 'DNSHE DNS create 失败' } }, 400);
    }
    return c.json(json, 201);
  } catch (e: any) {
    return c.json({ error: { code: 'REQUEST_ERROR', message: e?.message || String(e) } }, 400);
  }
});

app.put('/accounts/:id/subdomains/:subId/dns-records/:recId', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const recId = parseInt(c.req.param('recId'), 10);
  try {
    const { acc, apiKey, apiSecret } = await loadDnsheConfig(c.env, id);
    if (acc.provider_code !== 'dnshe') {
      return c.json({ error: { code: 'provider_not_implemented', message: `仅支持 dnshe` } }, 400);
    }
    const body = await c.req.json().catch(() => ({}));
    const url = new URL(acc.api_base_url);
    url.searchParams.set('m', 'domain_hub');
    url.searchParams.set('endpoint', 'dns_records');
    url.searchParams.set('action', 'update');
    const params: any = {};
    if (!isNaN(recId)) params.id = recId;
    for (const k of ['type', 'name', 'content', 'ttl', 'priority', 'line']) {
      if (body[k] !== undefined) params[k] = body[k];
    }
    const resp = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json: any = await resp.json().catch(() => ({}));
    if (json?.success === false) {
      return c.json({ error: { code: json.error_code || 'unknown_error', message: json.message || json.error || 'DNSHE DNS update 失败' } }, 400);
    }
    return c.json(json);
  } catch (e: any) {
    return c.json({ error: { code: 'REQUEST_ERROR', message: e?.message || String(e) } }, 400);
  }
});

app.delete('/accounts/:id/subdomains/:subId/dns-records/:recId', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const recId = parseInt(c.req.param('recId'), 10);
  try {
    const { acc, apiKey, apiSecret } = await loadDnsheConfig(c.env, id);
    if (acc.provider_code !== 'dnshe') {
      return c.json({ error: { code: 'provider_not_implemented', message: `仅支持 dnshe` } }, 400);
    }
    const url = new URL(acc.api_base_url);
    url.searchParams.set('m', 'domain_hub');
    url.searchParams.set('endpoint', 'dns_records');
    url.searchParams.set('action', 'delete');
    const params: any = {};
    if (!isNaN(recId)) params.id = recId;
    const resp = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const json: any = await resp.json().catch(() => ({}));
    if (json?.success === false) {
      return c.json({ error: { code: json.error_code || 'unknown_error', message: json.message || json.error || 'DNSHE DNS delete 失败' } }, 400);
    }
    return c.json(json);
  } catch (e: any) {
    return c.json({ error: { code: 'REQUEST_ERROR', message: e?.message || String(e) } }, 400);
  }
});

// ============ Quota ============

app.get('/accounts/:id/quota', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  try {
    const { acc, apiKey, apiSecret } = await loadDnsheConfig(c.env, id);
    if (acc.provider_code !== 'dnshe') {
      return c.json({ error: { code: 'provider_not_implemented', message: `仅支持 dnshe` } }, 400);
    }
    const url = new URL(acc.api_base_url);
    url.searchParams.set('m', 'domain_hub');
    url.searchParams.set('endpoint', 'quota');
    const resp = await fetch(url.toString(), {
      headers: { 'X-API-Key': apiKey, 'X-API-Secret': apiSecret, 'Content-Type': 'application/json' },
    });
    const json: any = await resp.json().catch(() => ({}));
    if (json?.success === false) {
      return c.json({ error: { code: json.error_code || 'unknown_error', message: json.message || json.error || 'DNSHE quota 失败' } }, 400);
    }
    return c.json(json);
  } catch (e: any) {
    return c.json({ error: { code: 'REQUEST_ERROR', message: e?.message || String(e) } }, 400);
  }
});

export default app;
