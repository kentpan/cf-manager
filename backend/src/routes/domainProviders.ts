import { Router, Request, Response, NextFunction } from 'express';
import {
  DomainProvider,
  DomainProviderAccount,
  getAllProviders,
  getProviderById,
  createProvider,
  updateProvider,
  deleteProvider,
  getAccountsByProvider,
  getAccountById,
  getAccountWithProvider,
  createProviderAccount,
  updateProviderAccount,
  deleteProviderAccount,
} from '../models/domainProvider';
import { encrypt } from '../services/encryptionService';
import { DecryptError } from '../services/cfFactory';
import {
  DnsheApiError,
  buildConfig,
  decryptProviderAccountCreds,
  listSubdomains,
  getSubdomain,
  registerSubdomain,
  deleteSubdomain,
  renewSubdomain,
  listDnsRecords,
  createDnsRecord,
  updateDnsRecord,
  deleteDnsRecord,
  getQuota,
  listApiKeys,
  testConnection,
  logDnsheError,
} from '../services/dnsheService';
import { appLogger } from '../services/logger';

const router = Router();

function maskCreds(a: DomainProviderAccount) {
  return {
    ...a,
    api_key: a.api_key ? '***encrypted***' : null,
    api_secret: a.api_secret ? '***encrypted***' : null,
  };
}

function toErrRes(err: unknown) {
  if (err instanceof DnsheApiError) {
    return { code: err.code, message: err.message, httpStatus: err.httpStatus, details: err.details };
  }
  if (err instanceof DecryptError) {
    return { code: 'decrypt_error', message: err.message, httpStatus: 500 };
  }
  return { code: 'internal_error', message: (err as any)?.message || String(err), httpStatus: 500 };
}

// ============ Provider CRUD ============

router.get('/', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const providers = getAllProviders();
    res.json({ providers });
  } catch (err) { next(err); }
});

router.post('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, name, api_base_url, promo_url, is_default, enabled } = req.body || {};
    if (!code || !name || !api_base_url) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'code, name, api_base_url 必填' } });
      return;
    }
    const id = createProvider({ code, name, api_base_url, promo_url, is_default, enabled });
    res.status(201).json({ id, code, name, api_base_url, promo_url, is_default: is_default ?? 0, enabled: enabled ?? 1 });
  } catch (err) { next(err); }
});

router.put('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!getProviderById(id)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '域名提供商不存在' } });
      return;
    }
    updateProvider(id, req.body || {});
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const provider = getProviderById(id);
    if (!provider) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '域名提供商不存在' } });
      return;
    }
    if (provider.is_default) {
      res.status(400).json({ error: { code: 'DEFAULT_PROVIDER', message: '内置默认提供商不可删除，可编辑或禁用' } });
      return;
    }
    deleteProvider(id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ============ Accounts under a provider ============

router.get('/:providerId/accounts', (req: Request, res: Response, next: NextFunction) => {
  try {
    const providerId = parseInt(String(req.params.providerId), 10);
    if (!getProviderById(providerId)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '域名提供商不存在' } });
      return;
    }
    const accounts = getAccountsByProvider(providerId).map(maskCreds);
    res.json({ accounts });
  } catch (err) { next(err); }
});

router.post('/:providerId/accounts', (req: Request, res: Response, next: NextFunction) => {
  try {
    const providerId = parseInt(String(req.params.providerId), 10);
    const provider = getProviderById(providerId);
    if (!provider) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '域名提供商不存在' } });
      return;
    }
    const { name, api_key, api_secret, api_user, is_active } = req.body || {};
    if (!name || !api_key) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name, api_key 必填' } });
      return;
    }
    // Some providers (DNSHE, Namecheap) require a second/third credential.
    // We don't enforce that at the route level — the service layer throws a
    // typed error if a needed field is missing when the user actually tries
    // to use the account. This keeps the door open for single-token providers
    // (Porkbun, Namesilo) where api_secret is genuinely optional.
    const id = createProviderAccount(
      providerId,
      { name, api_key, api_secret, api_user, is_active },
      encrypt(api_key),
      api_secret ? encrypt(api_secret) : '',
      api_user ? encrypt(api_user) : '',
    );
    res.status(201).json({ id, provider_id: providerId, name, is_active: is_active ?? 1, api_key: '***', api_secret: '***', api_user: '***' });
  } catch (err) { next(err); }
});

router.put('/accounts/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const existing = getAccountById(id);
    if (!existing) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '账号不存在' } });
      return;
    }
    const { name, api_key, api_secret, api_user, is_active } = req.body || {};
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (is_active !== undefined) updates.is_active = is_active;
    if (api_key) updates.api_key = encrypt(api_key);
    if (api_secret) updates.api_secret = encrypt(api_secret);
    if (api_user) updates.api_user = encrypt(api_user);
    updateProviderAccount(id, updates);
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete('/accounts/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (!getAccountById(id)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '账号不存在' } });
      return;
    }
    deleteProviderAccount(id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// Helper: load account + decrypt creds + build DNSHE config.
function loadDnsheConfig(accountId: number) {
  const acc = getAccountWithProvider(accountId);
  if (!acc) throw new DnsheApiError('not_found', `账号 #${accountId} 不存在`, 404);
  const { apiKey, apiSecret, apiUser } = decryptProviderAccountCreds(acc);
  return { acc, cfg: buildConfig(acc.provider_code, acc.api_base_url, apiKey, apiSecret, apiUser) };
}

// ============ Account: connection test ============
router.post('/accounts/:id/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { acc, cfg } = loadDnsheConfig(id);
    try {
      const result = await testConnection(cfg);
      updateProviderAccount(id, { last_synced: new Date().toISOString().replace('T', ' ').substring(0, 19), last_error: null });
      res.json({ success: true, quota: result.quota?.quota || result.quota });
    } catch (err) {
      logDnsheError(id, acc.name, err);
      const info = toErrRes(err);
      updateProviderAccount(id, { last_error: `${info.code}: ${info.message}` });
      res.status(400)
        .json({ error: { code: info.code, message: info.message, details: info.details } });
    }
  } catch (err) {
    const info = toErrRes(err);
    res.status(info.httpStatus === 404 ? 404 : 500).json({ error: { code: info.code, message: info.message } });
  }
});

// ============ Subdomains ============

router.get('/accounts/:id/subdomains', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { acc, cfg } = loadDnsheConfig(id);
    try {
      const opts: any = {};
      if (req.query.search) opts.search = String(req.query.search);
      if (req.query.status) opts.status = String(req.query.status);
      if (req.query.page) opts.page = Number(req.query.page);
      if (req.query.per_page) opts.per_page = Number(req.query.per_page);
      const result = await listSubdomains(cfg, opts);
      res.json({ account_id: id, account_name: acc.name, ...result });
    } catch (err) {
      logDnsheError(id, acc.name, err);
      const info = toErrRes(err);
      res.status(400)
        .json({ error: { code: info.code, message: info.message, details: info.details } });
    }
  } catch (err) { next(err); }
});

router.post('/accounts/:id/subdomains', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { acc, cfg } = loadDnsheConfig(id);
    const { subdomain, rootdomain } = req.body || {};
    if (!subdomain || !rootdomain) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'subdomain, rootdomain 必填' } });
      return;
    }
    try {
      const result = await registerSubdomain(cfg, subdomain, rootdomain);
      res.status(201).json(result);
    } catch (err) {
      logDnsheError(id, acc.name, err);
      const info = toErrRes(err);
      res.status(400)
        .json({ error: { code: info.code, message: info.message, details: info.details } });
    }
  } catch (err) { next(err); }
});

router.get('/accounts/:id/subdomains/:subId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { acc, cfg } = loadDnsheConfig(id);
    try {
      const result = await getSubdomain(cfg, parseInt(String(req.params.subId), 10));
      res.json(result);
    } catch (err) {
      logDnsheError(id, acc.name, err);
      const info = toErrRes(err);
      res.status(400)
        .json({ error: { code: info.code, message: info.message, details: info.details } });
    }
  } catch (err) { next(err); }
});

router.delete('/accounts/:id/subdomains/:subId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { acc, cfg } = loadDnsheConfig(id);
    try {
      const result = await deleteSubdomain(cfg, parseInt(String(req.params.subId), 10));
      res.json(result);
    } catch (err) {
      logDnsheError(id, acc.name, err);
      const info = toErrRes(err);
      res.status(400)
        .json({ error: { code: info.code, message: info.message, details: info.details } });
    }
  } catch (err) { next(err); }
});

router.post('/accounts/:id/subdomains/:subId/renew', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { acc, cfg } = loadDnsheConfig(id);
    try {
      const result = await renewSubdomain(cfg, parseInt(String(req.params.subId), 10));
      res.json(result);
    } catch (err) {
      logDnsheError(id, acc.name, err);
      const info = toErrRes(err);
      res.status(400)
        .json({ error: { code: info.code, message: info.message, details: info.details } });
    }
  } catch (err) { next(err); }
});

// ============ DNS Records ============

router.get('/accounts/:id/subdomains/:subId/dns-records', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { acc, cfg } = loadDnsheConfig(id);
    try {
      const records = await listDnsRecords(cfg, parseInt(String(req.params.subId), 10));
      res.json({ account_id: id, account_name: acc.name, records });
    } catch (err) {
      logDnsheError(id, acc.name, err);
      const info = toErrRes(err);
      res.status(400)
        .json({ error: { code: info.code, message: info.message, details: info.details } });
    }
  } catch (err) { next(err); }
});

router.post('/accounts/:id/subdomains/:subId/dns-records', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { acc, cfg } = loadDnsheConfig(id);
    const subId = parseInt(String(req.params.subId), 10);
    const { type, name, content, ttl, priority, line } = req.body || {};
    if (!type || !content) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'type, content 必填' } });
      return;
    }
    try {
      const result = await createDnsRecord(cfg, { subdomain_id: subId, type, name, content, ttl, priority, line });
      res.status(201).json(result);
    } catch (err) {
      logDnsheError(id, acc.name, err);
      const info = toErrRes(err);
      res.status(400)
        .json({ error: { code: info.code, message: info.message, details: info.details } });
    }
  } catch (err) { next(err); }
});

router.put('/accounts/:id/subdomains/:subId/dns-records/:recId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { acc, cfg } = loadDnsheConfig(id);
    const recIdNum = parseInt(String(req.params.recId), 10);
    const body = req.body || {};
    try {
      // Prefer internal `id` (numeric) — fall back to record_id (string hash)
      const params: any = {};
      if (!isNaN(recIdNum)) params.id = recIdNum;
      else params.record_id = String(req.params.recId);
      for (const k of ['type', 'name', 'content', 'ttl', 'priority', 'line']) {
        if (body[k] !== undefined) params[k] = body[k];
      }
      const result = await updateDnsRecord(cfg, params);
      res.json(result);
    } catch (err) {
      logDnsheError(id, acc.name, err);
      const info = toErrRes(err);
      res.status(400)
        .json({ error: { code: info.code, message: info.message, details: info.details } });
    }
  } catch (err) { next(err); }
});

router.delete('/accounts/:id/subdomains/:subId/dns-records/:recId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { acc, cfg } = loadDnsheConfig(id);
    const recIdNum = parseInt(String(req.params.recId), 10);
    try {
      const params: any = {};
      if (!isNaN(recIdNum)) params.id = recIdNum;
      else params.record_id = String(req.params.recId);
      const result = await deleteDnsRecord(cfg, params);
      res.json(result);
    } catch (err) {
      logDnsheError(id, acc.name, err);
      const info = toErrRes(err);
      res.status(400)
        .json({ error: { code: info.code, message: info.message, details: info.details } });
    }
  } catch (err) { next(err); }
});

// ============ Quota / API keys (provider-side) ============

router.get('/accounts/:id/quota', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { acc, cfg } = loadDnsheConfig(id);
    try {
      const result = await getQuota(cfg);
      res.json(result);
    } catch (err) {
      logDnsheError(id, acc.name, err);
      const info = toErrRes(err);
      res.status(400)
        .json({ error: { code: info.code, message: info.message, details: info.details } });
    }
  } catch (err) { next(err); }
});

router.get('/accounts/:id/api-keys', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const { acc, cfg } = loadDnsheConfig(id);
    try {
      const result = await listApiKeys(cfg);
      res.json(result);
    } catch (err) {
      logDnsheError(id, acc.name, err);
      const info = toErrRes(err);
      res.status(400)
        .json({ error: { code: info.code, message: info.message, details: info.details } });
    }
  } catch (err) { next(err); }
});

export default router;
