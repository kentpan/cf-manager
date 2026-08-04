import { Hono } from 'hono';
import type { Env } from '../types';
import { getActiveAccountsByFeature } from '../db/models';
import { getAuthHeaders, cfFetchAll } from '../services/cfApi';
import type { Account } from '../db/models';

const app = new Hono<{ Bindings: Env }>();

const CF_BASE = 'https://api.cloudflare.com/client/v4';

function formatAccountError(err: any): { error: string; error_kind: 'decrypt' | 'api' } {
  const msg = err?.message || String(err);
  if (msg.includes('decrypt') || msg.includes('Unsupported state') || msg.includes('authenticate data')) {
    return { error: '凭证解密失败：当前 ENCRYPTION_KEY 与数据库中存储的密文不匹配。', error_kind: 'decrypt' };
  }
  return { error: msg, error_kind: 'api' };
}

async function getAccountSubdomain(account: Account, authHeaders: Record<string, string>): Promise<string> {
  try {
    const resp = await fetch(`${CF_BASE}/accounts/${account.account_id}/workers/subdomain`, {
      headers: { 'Content-Type': 'application/json', ...authHeaders },
    });
    if (!resp.ok) return '';
    const json: any = await resp.json();
    return json?.result?.subdomain || '';
  } catch {
    return '';
  }
}

async function resolveEntryUrl(
  account: Account,
  encryptionKey: string,
  workerName: string,
  type: 'worker' | 'pages',
  customUrl?: string,
): Promise<string> {
  if (customUrl) {
    return /^https?:\/\//i.test(customUrl) ? customUrl : `https://${customUrl}`;
  }

  if (type === 'pages') {
    try {
      const projects = await cfFetchAll<any>(account, `/accounts/${account.account_id}/pages/projects`, encryptionKey, 50);
      const proj = projects.find((p: any) => p.name === workerName);
      if (proj) {
        const domains = proj.domains || [];
        const customDomain = domains.find((d: string) => !d.endsWith('.pages.dev'));
        const picked = customDomain || domains[0] || `${workerName}.pages.dev`;
        return /^https?:\/\//i.test(picked) ? picked : `https://${picked}`;
      }
    } catch (e) {
      console.warn(`[PagesAggregator] resolveEntryUrl pages ${workerName}: ${e}`);
    }
    return `https://${workerName}.pages.dev`;
  }

  // Worker — try custom domains via CF REST API, fallback to workers.dev subdomain.
  try {
    const authHeaders = await getAuthHeaders(account, encryptionKey);
    const resp = await fetch(`${CF_BASE}/accounts/${account.account_id}/workers/scripts/${encodeURIComponent(workerName)}/domains`, {
      headers: { 'Content-Type': 'application/json', ...authHeaders },
    });
    if (resp.ok) {
      const json: any = await resp.json();
      const domains = json?.result || [];
      if (domains.length > 0) {
        const d = domains[0].hostname || domains[0];
        return /^https?:\/\//i.test(d) ? d : `https://${d}`;
      }
    }
  } catch (e) {
    console.warn(`[PagesAggregator] resolveEntryUrl worker ${workerName} domains: ${e}`);
  }

  const subdomain = await getAccountSubdomain(account, encryptionKey);
  if (subdomain) {
    return `https://${workerName}.${subdomain}.workers.dev`;
  }
  return `https://${workerName}.workers.dev`;
}

app.get('/', async (c) => {
  const accounts = await getActiveAccountsByFeature(c.env.DB, 'workers');

  const perAccount = await Promise.all(accounts.map(async (account) => {
    if (!account.account_id) {
      return {
        account_id: account.id,
        account_name: account.name,
        account_email: account.email,
        cf_account_id: account.account_id,
        projects: [],
        error: 'Account ID not configured',
        error_kind: 'api' as const,
      };
    }
    try {
      const items: any[] = [];
      const [workersRes, pagesRes] = await Promise.allSettled([
        cfFetchAll<any>(account, `/accounts/${account.account_id}/workers/scripts`, c.env.ENCRYPTION_KEY, 50),
        cfFetchAll<any>(account, `/accounts/${account.account_id}/pages/projects`, c.env.ENCRYPTION_KEY, 50),
      ]);
      if (workersRes.status === 'fulfilled') {
        items.push(...workersRes.value.map((w: any) => ({
          ...w, name: w.id, status: 'deployed', type: 'worker',
          cfAccountId: account.id, accountName: account.name,
          domains: [],
        })));
      } else {
        console.error(`[PagesAggregator] workers list failed for ${account.name}: ${workersRes.reason}`);
      }
      if (pagesRes.status === 'fulfilled') {
        items.push(...pagesRes.value.map((p: any) => ({
          ...p, name: p.name ?? p.id, type: 'pages',
          cfAccountId: account.id, accountName: account.name,
          domains: p.domains && p.domains.length > 0 ? p.domains : [`${p.name}.pages.dev`],
        })));
      } else {
        console.error(`[PagesAggregator] pages list failed for ${account.name}: ${pagesRes.reason}`);
      }
      return {
        account_id: account.id,
        account_name: account.name,
        account_email: account.email,
        cf_account_id: account.account_id,
        projects: items,
        error: null,
        error_kind: null,
      };
    } catch (err: any) {
      console.error(`[PagesAggregator] account ${account.name} (${account.id}) failed: ${err?.message || err}`);
      const info = formatAccountError(err);
      return {
        account_id: account.id,
        account_name: account.name,
        account_email: account.email,
        cf_account_id: account.account_id,
        projects: [],
        error: info.error,
        error_kind: info.error_kind,
      };
    }
  }));

  const flat = perAccount.flatMap((acc: any) =>
    (acc.projects || []).map((p: any) => ({
      account_id: acc.account_id,
      account_name: acc.account_name,
      account_email: acc.account_email,
      cf_account_id: acc.cf_account_id,
      ...p,
    })),
  );

  return c.json({
    total_projects: flat.length,
    total_accounts: accounts.length,
    healthy_accounts: perAccount.filter((a: any) => !a.error).length,
    failed_accounts: perAccount
      .filter((a: any) => a.error)
      .map((a: any) => ({ account_id: a.account_id, account_name: a.account_name, error: a.error, error_kind: a.error_kind })),
    accounts: perAccount,
    projects: flat,
  });
});

export default app;
