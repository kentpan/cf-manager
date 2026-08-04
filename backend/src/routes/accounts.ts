import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import Cloudflare from 'cloudflare';
import { getAllAccounts, createAccount, deleteAccount, getAccountById, getAccountByEmail, nameFromEmail, updateAccountStatus, updateAccountId, updateAccountFeatures, updateAccount, AccountInput } from '../models/account';
import { listAccountsPaged, AccountListFilter } from '../models/account';
import { encrypt } from '../services/encryptionService';
import { decrypt } from '../services/encryptionService';
import { getCfClient } from '../services/cfFactory';
import { getQuotaSummary } from '../services/quotaTracker';
import { clearCache } from '../services/accountRouter';
import { appLogger } from '../services/logger';
import { createAuditLog } from '../models/auditLog';
import { getHttpAgent } from '../services/proxyService';
import { clearExhausted } from '../models/quotaUsage';
import { isDemoAccountId } from './routeUtils';
import { probeAvailableFeatures } from '../services/accountProbe';
import { getDb } from '../db';

const router = Router();

const uploadCsv = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * Detect accounts whose stored encrypted credentials can no longer be
 * decrypted with the current ENCRYPTION_KEY. This typically happens after
 * the .env ENCRYPTION_KEY is rotated or after the SQLite DB is moved
 * between hosts. Returns the list of affected account IDs.
 *
 * Surface this in the GET / response so the UI can show a "needs re-auth"
 * badge and offer the reset-credentials action without breaking the whole
 * account list.
 */
function findAccountsWithBrokenCredentials(accountIds?: number[]): number[] {
  const ids = accountIds && accountIds.length > 0
    ? accountIds
    : (getAllAccounts().map(a => a.id));
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT id, api_token, api_key, password FROM accounts WHERE id IN (${placeholders})`)
    .all(...ids) as Array<{ id: number; api_token: string | null; api_key: string | null; password: string | null }>;
  const broken: number[] = [];
  for (const r of rows) {
    let bad = false;
    for (const field of [r.api_token, r.api_key, r.password]) {
      if (!field) continue;
      try { decrypt(field); } catch { bad = true; break; }
    }
    if (bad) broken.push(r.id);
  }
  return broken;
}

router.get('/', (req: Request, res: Response, next: NextFunction) => {
  try {
    // 分页模式：当传入 page 或 pageSize 时启用；不传则保持原全量行为（向后兼容）
    const wantsPaged = req.query.page !== undefined || req.query.pageSize !== undefined;
    const quota = getQuotaSummary();
    // Detect broken-credential accounts once per list call so the UI can flag
    // them without having to actually try each one through Cloudflare.
    const brokenIds = new Set(findAccountsWithBrokenCredentials());
    if (wantsPaged) {
      const filter = (req.query.filter as string) as AccountListFilter;
      const validFilters: AccountListFilter[] = ['all', 'active', 'unverified'];
      const safeFilter: AccountListFilter = validFilters.includes(filter) ? filter : 'all';
      const paged = listAccountsPaged({
        page: parseInt(req.query.page as string, 10) || 1,
        pageSize: parseInt(req.query.pageSize as string, 10) || 20,
        filter: safeFilter,
        search: (req.query.search as string) || '',
      });
      const accounts = paged.accounts.map(a => ({
        ...a,
        api_token: a.api_token ? '***encrypted***' : null,
        api_key: a.api_key ? '***encrypted***' : null,
        is_demo: isDemoAccountId(a.id),
        decrypt_error: brokenIds.has(a.id),
      }));
      res.json({ accounts, quota, total: paged.total, counts: paged.counts });
    } else {
      const accounts = getAllAccounts().map(a => ({
        ...a,
        api_token: a.api_token ? '***encrypted***' : null,
        api_key: a.api_key ? '***encrypted***' : null,
        is_demo: isDemoAccountId(a.id),
        decrypt_error: brokenIds.has(a.id),
      }));
      res.json({ accounts, quota });
    }
  } catch (err) { next(err); }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, auth_type, account_id, api_token, api_key, email } = req.body;
    if (!name || !auth_type) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name and auth_type are required' } });
      return;
    }
    if (auth_type !== 'token' && auth_type !== 'global_key') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'auth_type must be "token" or "global_key"' } });
      return;
    }
    if (auth_type === 'token' && !api_token) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'api_token is required for token auth' } });
      return;
    }
    if (auth_type === 'global_key' && (!api_key || !email)) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'api_key and email are required for global_key auth' } });
      return;
    }

    // Verify credentials before saving
    try {
      const httpAgent = getHttpAgent();
      const opts: Record<string, any> = {};
      if (httpAgent) opts.httpAgent = httpAgent;

      let tempCf: Cloudflare;
      if (auth_type === 'token') {
        tempCf = new Cloudflare({ apiToken: api_token, ...opts });
      } else {
        tempCf = new Cloudflare({ apiEmail: email, apiKey: api_key, ...opts });
      }
      await tempCf.user.get();
    } catch (e: any) {
      res.status(400).json({ error: { code: 'CREDENTIAL_INVALID', message: `Cloudflare API 凭证验证失败: ${e.message || e}` } });
      return;
    }

    const input: AccountInput = { name, auth_type, account_id, enabled_features: req.body.enabled_features, proxy_url: req.body.proxy_url, proxy_enabled: req.body.proxy_enabled };
    if (auth_type === 'token') {
      input.api_token = encrypt(api_token);
    } else {
      input.api_key = encrypt(api_key);
      input.email = email;
    }
    const id = createAccount(input);

    if (!account_id) {
      try {
        const saved = getAccountById(id);
        if (saved) {
          const cf = getCfClient(saved);
          const accts: any[] = [];
          for await (const acct of cf.accounts.list()) {
            accts.push(acct as any);
          }
          if (accts.length > 0) {
            updateAccountId(id, accts[0].id);
            appLogger.info(`[Account] Auto-fetched account_id=${accts[0].id} for "${name}"`);
          }
          updateAccountStatus(id, true);
        }
      } catch (e) {
        appLogger.warn(`[Account] Failed to auto-fetch account_id for "${name}": ${e}`);
      }
    }

    // 探测 R2 可用性（重新获取，account_id 可能刚被更新）
    try {
      const fresh = getAccountById(id);
      if (fresh) {
        const features = await probeAvailableFeatures(fresh);
        if (features) updateAccount(id, { available_features: features });
      }
    } catch (e) {
      appLogger.warn(`[Account] Failed to probe features for "${name}": ${e}`);
    }

    createAuditLog(id, 'create_account', name, `auth_type=${auth_type}`, 'success');
    res.status(201).json({ id, ...input, api_token: '***', api_key: '***' });
  } catch (err) { next(err); }
});

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isDemoAccountId(id)) {
      res.status(403).json({ error: { code: 'DEMO_PROTECTED', message: '演示账户不可编辑' } });
      return;
    }
    const existing = getAccountById(id);
    if (!existing) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } }); return; }

    const { name, auth_type, api_token, api_key, email } = req.body;
    if (!name || !auth_type) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name and auth_type are required' } });
      return;
    }
    if (auth_type !== 'token' && auth_type !== 'global_key') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'auth_type must be "token" or "global_key"' } });
      return;
    }

    const input: Partial<AccountInput> = { name, auth_type };
    const switching = existing.auth_type !== auth_type;

    // 处理 proxy_url / proxy_enabled（无论是否切换认证类型都允许设置）
    if (req.body.proxy_url !== undefined) {
      input.proxy_url = req.body.proxy_url;
    }
    if (req.body.proxy_enabled !== undefined) {
      input.proxy_enabled = req.body.proxy_enabled;
    }

    if (auth_type === 'token') {
      if (switching && !api_token) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '切换至 token 认证需提供 api_token' } });
        return;
      }
      if (api_token) {
        try {
          const tempCf = new Cloudflare({ apiToken: api_token, ...(getHttpAgent() ? { httpAgent: getHttpAgent() } : {}) });
          await tempCf.user.get();
        } catch (e: any) {
          res.status(400).json({ error: { code: 'CREDENTIAL_INVALID', message: `Cloudflare API 凭证验证失败: ${e.message || e}` } });
          return;
        }
        input.api_token = encrypt(api_token);
      }
      if (switching) { input.api_key = null; input.email = null; }
    } else {
      const hasEmail = !!email, hasKey = !!api_key;
      if (switching && (!hasEmail || !hasKey)) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '切换至 global_key 认证需同时提供 email 和 api_key' } });
        return;
      }
      if (hasEmail !== hasKey) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'email 与 api_key 需同时填写' } });
        return;
      }
      if (hasEmail && hasKey) {
        try {
          const tempCf = new Cloudflare({ apiEmail: email, apiKey: api_key, ...(getHttpAgent() ? { httpAgent: getHttpAgent() } : {}) });
          await tempCf.user.get();
        } catch (e: any) {
          res.status(400).json({ error: { code: 'CREDENTIAL_INVALID', message: `Cloudflare API 凭证验证失败: ${e.message || e}` } });
          return;
        }
        input.api_key = encrypt(api_key);
        input.email = email;
      }
      if (switching) { input.api_token = null; }
    }

    // 先保存，再重取 saved（确保用新凭证刷新 account_id 和探测）
    updateAccount(id, input);
    const saved = getAccountById(id);
    if (!saved) { res.status(500).json({ error: { code: 'INTERNAL', message: '保存后账户消失' } }); return; }

    // 自动刷新 account_id（触发条件：无 account_id 或提供了新凭证）
    if (!saved.account_id || input.api_token || input.api_key) {
      try {
        const cf = getCfClient(saved);
        const accts: any[] = [];
        for await (const acct of cf.accounts.list()) accts.push(acct as any);
        if (accts.length > 0) {
          updateAccountId(id, accts[0].id);
          appLogger.info(`[Account] Auto-fetched account_id=${accts[0].id} for "${name}"`);
        }
        updateAccountStatus(id, true);
      } catch (e) {
        appLogger.warn(`[Account] Failed to auto-fetch account_id for "${name}": ${e}`);
      }
    }

    clearCache();
    createAuditLog(id, 'update_account', name, `auth_type=${auth_type}`, 'success');

    // 若提供了新凭证，探测可用付费功能（R2...），失败不阻断
    if (input.api_token || input.api_key) {
      try {
        const probed = getAccountById(id);
        if (probed) {
          const features = await probeAvailableFeatures(probed);
          updateAccount(id, { available_features: features });
          appLogger.info(`[Account] Probed features for "${name}": ${features}`);
        }
      } catch (e) {
        appLogger.warn(`[Account] Failed to probe features for "${name}": ${e}`);
      }
    }

    res.json({ success: true });
  } catch (err) { next(err); }
});

router.patch('/:id/features', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isDemoAccountId(id)) {
      res.status(403).json({ error: { code: 'DEMO_PROTECTED', message: '演示账户不可修改' } });
      return;
    }
    const account = getAccountById(id);
    if (!account) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } }); return; }
    const { enabled_features } = req.body;
    if (typeof enabled_features !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'enabled_features is required' } });
      return;
    }
    updateAccountFeatures(id, enabled_features);
    clearCache();
    createAuditLog(id, 'update_features', account.name, enabled_features, 'success');
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.delete('/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isDemoAccountId(id)) {
      res.status(403).json({ error: { code: 'DEMO_PROTECTED', message: '演示账户不可删除' } });
      return;
    }
    const account = getAccountById(id);
    if (!account) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } }); return; }
    createAuditLog(id, 'delete_account', account.name, null, 'success');
    deleteAccount(id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ============ 查看账号凭证（解密后的 apiKey / apiToken） ============
router.get('/:id/credentials', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isDemoAccountId(id)) {
      res.status(403).json({ error: { code: 'DEMO_PROTECTED', message: '演示账户不可查看凭证' } });
      return;
    }
    const account = getAccountById(id);
    if (!account) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } }); return; }
    let api_token: string | null = null;
    let api_key: string | null = null;
    let password: string | null = null;
    try {
      if (account.api_token) api_token = decrypt(account.api_token);
      if (account.api_key) api_key = decrypt(account.api_key);
      if (account.password) password = decrypt(account.password);
    } catch (e) {
      appLogger.error(`[Account] 解密凭证失败 id=${id}: ${e}`);
      res.status(500).json({ error: { code: 'DECRYPT_ERROR', message: '凭证解密失败' } });
      return;
    }
    createAuditLog(id, 'view_credentials', account.name, account.auth_type, 'success');
    res.json({
      id: account.id,
      name: account.name,
      auth_type: account.auth_type,
      email: account.email,
      api_token,
      api_key,
      password,
      account_id: account.account_id,
      proxy_url: account.proxy_url || '',
      proxy_enabled: account.proxy_enabled || 0,
    });
  } catch (err) { next(err); }
});

router.post('/:id/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = parseInt(req.params.id as string, 10);
    const account = getAccountById(accountId);
    if (!account) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } }); return; }
    const cf = getCfClient(account);
    const user = await cf.user.get();

    // 自动获取并存储 Cloudflare Account ID
    if (!account.account_id) {
      try {
        const accounts: any[] = [];
        for await (const acct of cf.accounts.list()) {
          accounts.push(acct as any);
        }
        if (accounts.length > 0) {
          updateAccountId(accountId, accounts[0].id);
        }
      } catch (e) {
        // 获取账号列表失败不是致命错误，继续返回测试结果
        appLogger.warn(`Failed to fetch account list: ${e}`);
      }
    }

    // 测试成功，更新状态为活跃
    updateAccountStatus(accountId, true);

    // 探测 R2 可用性（重新获取，account_id 可能刚被更新）
    try {
      const fresh = getAccountById(accountId);
      if (fresh) {
        const features = await probeAvailableFeatures(fresh);
        if (features) updateAccount(accountId, { available_features: features });
      }
    } catch (e) {
      appLogger.warn(`[Account] Failed to probe features for account ${accountId}: ${e}`);
    }

    res.json({ success: true, user });
  } catch (err) { next(err); }
});

// ============ 清除 AI 配额耗尽标记 ============
router.post('/:id/clear-exhausted', (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isDemoAccountId(id)) {
      res.status(403).json({ error: { code: 'DEMO_PROTECTED', message: '演示账户不可操作' } });
      return;
    }
    const account = getAccountById(id);
    if (!account) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Account not found' } }); return; }
    clearExhausted(id, 'ai_neurons');
    createAuditLog(id, 'clear_exhausted', account.name, 'ai_neurons', 'success');
    res.json({ success: true, message: '已清除 AI 配额耗尽标记' });
  } catch (err) { next(err); }
});

// ============ 批量测试 ============
// body: { ids?: number[], onlyUnverified?: boolean }
// 不传 ids 且 onlyUnverified=true 时，测试所有 is_active=0 的账户
router.post('/test-batch', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const onlyUnverified = req.body?.onlyUnverified === true || req.body?.onlyUnverified === 'true';
    const ids: number[] | undefined = Array.isArray(req.body?.ids)
      ? req.body.ids.map((x: any) => parseInt(x, 10)).filter((n: number) => !isNaN(n))
      : undefined;

    let targets = getAllAccounts();
    if (ids && ids.length > 0) {
      const idSet = new Set(ids);
      targets = targets.filter(a => idSet.has(a.id));
    } else if (onlyUnverified) {
      targets = targets.filter(a => a.is_active === 0);
    }
    // 跳过演示账户
    targets = targets.filter(a => !isDemoAccountId(a.id));

    const results: Array<{ id: number; name: string; status: 'success' | 'error'; message?: string }> = [];

    async function testOne(account: { id: number; name: string }): Promise<void> {
      try {
        const cf = getCfClient(getAccountById(account.id)!);
        await cf.user.get();
        // 自动获取 account_id
        const saved = getAccountById(account.id);
        if (saved && !saved.account_id) {
          try {
            const accts: any[] = [];
            for await (const acct of cf.accounts.list()) {
              accts.push(acct as any);
            }
            if (accts.length > 0) {
              updateAccountId(account.id, accts[0].id);
            }
          } catch (e) {
            appLogger.warn(`[Account:TestBatch] Failed to fetch account_id for "${account.name}": ${e}`);
          }
        }
        updateAccountStatus(account.id, true);

        // 探测 R2 可用性（重新获取，account_id 可能刚被更新）
        try {
          const fresh = getAccountById(account.id);
          if (fresh) {
            const features = await probeAvailableFeatures(fresh);
            if (features) updateAccount(account.id, { available_features: features });
          }
        } catch (e) {
          appLogger.warn(`[Account:TestBatch] Failed to probe features for "${account.name}": ${e}`);
        }

        createAuditLog(account.id, 'test_account', account.name, 'batch', 'success');
        results.push({ id: account.id, name: account.name, status: 'success' });
      } catch (e: any) {
        // 测试失败：标记为未活跃
        updateAccountStatus(account.id, false);
        createAuditLog(account.id, 'test_account', account.name, `batch: ${e.message || e}`, 'error');
        results.push({ id: account.id, name: account.name, status: 'error', message: e.message || String(e) });
      }
    }

    // 并发批处理：每批 5 条并发
    const BATCH_CONCURRENCY = 5;
    for (let i = 0; i < targets.length; i += BATCH_CONCURRENCY) {
      const batch = targets.slice(i, i + BATCH_CONCURRENCY);
      await Promise.all(batch.map(t => testOne(t)));
    }

    clearCache();
    const summary = {
      total: results.length,
      success: results.filter(r => r.status === 'success').length,
      error: results.filter(r => r.status === 'error').length,
    };
    appLogger.info(`[Account:TestBatch] 批量测试完成: 共 ${summary.total}，成功 ${summary.success}，失败 ${summary.error}`);
    res.json({ summary, results });
  } catch (err) { next(err); }
});

// ============ 批量设置功能开关 ============
router.post('/batch/features', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids, enabled_features } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ids 必须是非空数组' } });
      return;
    }
    if (typeof enabled_features !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'enabled_features 是必填字符串' } });
      return;
    }
    const results: Array<{ id: number; name: string; status: 'success' | 'skipped' | 'error'; message?: string }> = [];
    for (const rawId of ids) {
      const id = parseInt(rawId, 10);
      if (isNaN(id)) { results.push({ id: rawId, name: '', status: 'error', message: '无效 ID' }); continue; }
      if (isDemoAccountId(id)) { results.push({ id, name: '', status: 'skipped', message: '演示账户不可修改' }); continue; }
      const account = getAccountById(id);
      if (!account) { results.push({ id, name: '', status: 'error', message: '账户不存在' }); continue; }
      try {
        updateAccountFeatures(id, enabled_features);
        createAuditLog(id, 'batch_update_features', account.name, enabled_features, 'success');
        results.push({ id, name: account.name, status: 'success' });
      } catch (e: any) {
        results.push({ id, name: account.name, status: 'error', message: e.message || String(e) });
      }
    }
    clearCache();
    res.json({ summary: { total: results.length, success: results.filter(r => r.status === 'success').length, skipped: results.filter(r => r.status === 'skipped').length, error: results.filter(r => r.status === 'error').length }, results });
  } catch (err) { next(err); }
});

// ============ 批量删除 ============
router.post('/batch/delete', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ids 必须是非空数组' } });
      return;
    }
    const results: Array<{ id: number; name: string; status: 'success' | 'skipped' | 'error'; message?: string }> = [];
    for (const rawId of ids) {
      const id = parseInt(rawId, 10);
      if (isNaN(id)) { results.push({ id: rawId, name: '', status: 'error', message: '无效 ID' }); continue; }
      if (isDemoAccountId(id)) { results.push({ id, name: '', status: 'skipped', message: '演示账户不可删除' }); continue; }
      const account = getAccountById(id);
      if (!account) { results.push({ id, name: '', status: 'error', message: '账户不存在' }); continue; }
      try {
        createAuditLog(id, 'batch_delete_account', account.name, null, 'success');
        deleteAccount(id);
        results.push({ id, name: account.name, status: 'success' });
      } catch (e: any) {
        results.push({ id, name: account.name, status: 'error', message: e.message || String(e) });
      }
    }
    clearCache();
    res.json({ summary: { total: results.length, success: results.filter(r => r.status === 'success').length, skipped: results.filter(r => r.status === 'skipped').length, error: results.filter(r => r.status === 'error').length }, results });
  } catch (err) { next(err); }
});

// ============ 批量设置代理 ============
router.post('/batch/proxy', (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids, proxy_url, proxy_enabled } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'ids 必须是非空数组' } });
      return;
    }
    const updateData: Partial<AccountInput> = {};
    if (proxy_url !== undefined) updateData.proxy_url = proxy_url;
    if (proxy_enabled !== undefined) updateData.proxy_enabled = proxy_enabled ? 1 : 0;
    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '至少需要提供 proxy_url 或 proxy_enabled' } });
      return;
    }
    const results: Array<{ id: number; name: string; status: 'success' | 'skipped' | 'error'; message?: string }> = [];
    for (const rawId of ids) {
      const id = parseInt(rawId, 10);
      if (isNaN(id)) { results.push({ id: rawId, name: '', status: 'error', message: '无效 ID' }); continue; }
      if (isDemoAccountId(id)) { results.push({ id, name: '', status: 'skipped', message: '演示账户不可修改' }); continue; }
      const account = getAccountById(id);
      if (!account) { results.push({ id, name: '', status: 'error', message: '账户不存在' }); continue; }
      try {
        updateAccount(id, updateData);
        createAuditLog(id, 'batch_update_proxy', account.name, JSON.stringify(updateData), 'success');
        results.push({ id, name: account.name, status: 'success' });
      } catch (e: any) {
        results.push({ id, name: account.name, status: 'error', message: e.message || String(e) });
      }
    }
    clearCache();
    res.json({ summary: { total: results.length, success: results.filter(r => r.status === 'success').length, skipped: results.filter(r => r.status === 'skipped').length, error: results.filter(r => r.status === 'error').length }, results });
  } catch (err) { next(err); }
});

// ============ 批量导入 CSV ============
// CSV 表头: email,password,apiKey
// 按邮箱去重；账户名按规则从邮箱提取；单个账户错误不影响批量导入
router.post('/import-csv', uploadCsv.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: '未提供 CSV 文件' } });
      return;
    }
    const raw = req.file.buffer.toString('utf8').replace(/^\uFEFF/, ''); // 去除 BOM
    const rows = parseCsv(raw);
    if (rows.length === 0) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'CSV 文件为空或无有效数据行' } });
      return;
    }

    const header = rows[0].map(h => h.trim().toLowerCase());
    const emailIdx = header.findIndex(h => h === 'email');
    const apiKeyIdx = header.findIndex(h => h === 'apikey' || h === 'api_key');
    const passwordIdx = header.findIndex(h => h === 'password');

    if (emailIdx === -1 || apiKeyIdx === -1) {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'CSV 必须包含 email 和 apiKey 列' } });
      return;
    }

    // skipVerify=1 跳过凭证验证（秒级完成），适合大批量导入 + 后续手动测试
    const skipVerify = req.body?.skipVerify === '1' || req.body?.skipVerify === 'true' || (req.query.skipVerify as string) === '1';

    const dataRows = rows.slice(1);
    const results: Array<{ email: string; name: string; status: 'success' | 'skipped' | 'error'; message?: string }> = [];
    const seenEmails = new Set<string>(); // 同批次内去重

    // 预过滤：解析 + 去重 + 数据库去重，生成待处理任务列表
    interface ImportTask {
      email: string;
      apiKey: string;
      password: string;
      name: string;
      result: { email: string; name: string; status: 'success' | 'skipped' | 'error'; message?: string };
    }
    const pendingTasks: ImportTask[] = [];
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const email = (row[emailIdx] || '').trim();
      const apiKey = (row[apiKeyIdx] || '').trim();
      const password = passwordIdx !== -1 ? (row[passwordIdx] || '').trim() : '';

      if (!email || !apiKey) {
        results.push({ email: email || '(空)', name: '', status: 'error', message: '邮箱或 apiKey 为空' });
        continue;
      }
      // 同批次内去重
      if (seenEmails.has(email)) {
        results.push({ email, name: nameFromEmail(email), status: 'skipped', message: 'CSV 内重复邮箱' });
        continue;
      }
      seenEmails.add(email);
      // 数据库去重
      if (getAccountByEmail(email)) {
        results.push({ email, name: nameFromEmail(email), status: 'skipped', message: '数据库已存在该邮箱' });
        continue;
      }
      pendingTasks.push({
        email, apiKey, password, name: nameFromEmail(email),
        result: { email, name: nameFromEmail(email), status: 'success' },
      });
    }

    // 处理单个任务：验证凭证 + 入库 + 自动获取 account_id
    async function processTask(task: ImportTask): Promise<void> {
      const { email, apiKey, password, name } = task;
      try {
        // 验证 Cloudflare 凭证（可跳过）
        if (!skipVerify) {
          try {
            const httpAgent = getHttpAgent();
            const opts: Record<string, any> = {};
            if (httpAgent) opts.httpAgent = httpAgent;
            const tempCf = new Cloudflare({ apiEmail: email, apiKey, ...opts });
            await tempCf.user.get();
          } catch (e: any) {
            task.result = { email, name, status: 'error', message: `凭证验证失败: ${e.message || e}` };
            return;
          }
        }
        // 保存到数据库
        const input: AccountInput = {
          name,
          auth_type: 'global_key',
          email,
          api_key: encrypt(apiKey),
          password: password ? encrypt(password) : undefined,
        };
        const id = createAccount(input);

        // 自动获取 account_id（跳过验证模式下也尝试获取，失败不阻断）
        if (!skipVerify) {
          try {
            const saved = getAccountById(id);
            if (saved) {
              const cf = getCfClient(saved);
              const accts: any[] = [];
              for await (const acct of cf.accounts.list()) {
                accts.push(acct as any);
              }
              if (accts.length > 0) {
                updateAccountId(id, accts[0].id);
                appLogger.info(`[Account:Import] Auto-fetched account_id=${accts[0].id} for "${name}"`);
              }
              updateAccountStatus(id, true);
            }
          } catch (e) {
            appLogger.warn(`[Account:Import] Failed to auto-fetch account_id for "${name}": ${e}`);
          }
        } else {
          // 跳过验证模式：标记为未验证，后续通过「测试」按钮激活
          updateAccountStatus(id, false);
        }

        createAuditLog(id, 'import_account', name, `email=${email}${skipVerify ? ' (skipVerify)' : ''}`, 'success');
        task.result = { email, name, status: 'success' };
      } catch (e: any) {
        task.result = { email, name, status: 'error', message: `保存失败: ${e.message || e}` };
      }
    }

    // 并发批处理：每批 5 条并发，批与批之间顺序执行
    const BATCH_CONCURRENCY = skipVerify ? 20 : 5; // 跳过验证时无需控制 CF API 并发，可大幅提高
    for (let i = 0; i < pendingTasks.length; i += BATCH_CONCURRENCY) {
      const batch = pendingTasks.slice(i, i + BATCH_CONCURRENCY);
      await Promise.all(batch.map(t => processTask(t)));
      batch.forEach(t => results.push(t.result));
    }

    clearCache();
    const summary = {
      total: results.length,
      success: results.filter(r => r.status === 'success').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      error: results.filter(r => r.status === 'error').length,
    };
    appLogger.info(`[Account:Import] CSV 批量导入完成${skipVerify ? ' (skipVerify)' : ''}: 共 ${summary.total}，成功 ${summary.success}，跳过 ${summary.skipped}，失败 ${summary.error}`);
    res.json({ summary, results });
  } catch (err) { next(err); }
});

/**
* 简单 CSV 解析器：支持双引号包裹的字段和字段内的逗号/换行/双引号转义
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  while (i < normalized.length) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      field = '';
      if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
        rows.push(row);
      }
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
      rows.push(row);
    }
  }
  return rows;
}

// ============ Repair: reset broken encrypted credentials ============
//
// Wipes api_token / api_key / password for accounts whose stored ciphertext
// can no longer be decrypted with the current ENCRYPTION_KEY (typical after
// .env rotation or DB migration). Account metadata (name, email, account_id,
// features) is preserved so the user can re-enter credentials in the UI.
//
// Optionally pass ?id=123 to scope the reset to a single account; otherwise
// every broken account is reset.
router.post('/reset-broken-credentials', (req: Request, res: Response, next: NextFunction) => {
  try {
    const scopeId = req.query.id ? Number(req.query.id) : undefined;
    const brokenIds = findAccountsWithBrokenCredentials(scopeId ? [scopeId] : undefined);
    if (brokenIds.length === 0) {
      res.json({ success: true, reset: [], message: 'No broken credentials found.' });
      return;
    }
    const placeholders = brokenIds.map(() => '?').join(',');
    getDb()
      .prepare(`
        UPDATE accounts
        SET api_token = NULL,
            api_key   = NULL,
            password  = NULL,
            is_active = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE id IN (${placeholders})
      `)
      .run(...brokenIds);

    for (const id of brokenIds) {
      const acc = getAccountById(id);
      createAuditLog(id, 'reset_broken_credentials', acc?.name || `#${id}`, 'wiped encrypted fields', 'success');
    }
    appLogger.info(`[Accounts] Reset broken credentials for ${brokenIds.length} account(s): ${brokenIds.join(', ')}`);
    clearCache();
    res.json({
      success: true,
      reset: brokenIds,
      message: `Reset ${brokenIds.length} account(s). Re-enter credentials in the management UI.`,
    });
  } catch (err) { next(err); }
});

export default router;
