import { Hono } from 'hono';
import type { Env } from '../types';
import { getActiveAccountsByFeature } from '../db/models';
import { cfFetch } from '../services/cfApi';

const app = new Hono<{ Bindings: Env }>();

function formatAccountError(err: any): { error: string; error_kind: 'decrypt' | 'api' } {
  const msg = err?.message || String(err);
  if (msg.includes('decrypt') || msg.includes('Unsupported state') || msg.includes('authenticate data')) {
    return { error: '凭证解密失败：当前 ENCRYPTION_KEY 与数据库中存储的密文不匹配。', error_kind: 'decrypt' };
  }
  return { error: msg, error_kind: 'api' };
}

/**
 * 将单个 CF Pages project 原始对象映射为聚合响应所需的结构（与 backend listPages 返回字段对齐）。
 * 显式列出字段，避免 ...p spread 把 CF 原生冗余字段（canonical_submission 等）带进响应。
 */
function mapPageProject(p: any) {
  return {
    id: p.id,
    name: p.name,
    // Cloudflare 返回 canonical `<project>.pages.dev` 子域在 domains 里；
    // 部分历史项目 domains 可能为空，始终合成 fallback 保证入口不丢
    domains: p.domains && p.domains.length > 0 ? p.domains : [`${p.name}.pages.dev`],
    production_branch: p.production_branch,
    created_on: p.created_on,
    modified_on: p.modified_on,
    deployment_count: p.deployment_count,
    source: p.source,
  };
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
      // 只聚合 Pages projects（与 backend 行为一致），不混入 workers scripts。
      // 用 cfFetch 不加 page/per_page：CF Pages API 不支持 page 参数（400 错误码 8000024），
      // 与 aggregateHomepage.ts:115 / workers.ts:39 既有惯例一致。
      const data = await cfFetch<{ result: any[] }>(
        account,
        `/accounts/${account.account_id}/pages/projects`,
        c.env.ENCRYPTION_KEY,
      );
      return {
        account_id: account.id,
        account_name: account.name,
        account_email: account.email,
        cf_account_id: account.account_id,
        projects: (data.result || []).map(mapPageProject),
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

/**
 * 深度拉取：合并每个 Pages project 的自定义域名（独立 CF API 调用）。
 * 与 backend /pages-aggregator/detailed 对齐：默认路由已返回 pages.dev 域名，
 * 此路由额外拉取自定义域名去重合并。仅在用户显式请求完整域名清单时调用。
 */
app.get('/detailed', async (c) => {
  const accounts = await getActiveAccountsByFeature(c.env.DB, 'workers');
  const flat: any[] = [];

  await Promise.all(accounts.map(async (account) => {
    if (!account.account_id) return;
    try {
      const projectsData = await cfFetch<{ result: any[] }>(
        account,
        `/accounts/${account.account_id}/pages/projects`,
        c.env.ENCRYPTION_KEY,
      );
      await Promise.all((projectsData.result || []).map(async (p) => {
        let extraDomains: string[] = [];
        try {
          const domainsData = await cfFetch<{ result: any[] }>(
            account,
            `/accounts/${account.account_id}/pages/projects/${encodeURIComponent(p.name)}/domains`,
            c.env.ENCRYPTION_KEY,
          );
          extraDomains = (domainsData.result || []).map((d: any) => d.name).filter(Boolean);
        } catch (err) {
          console.warn(`[PagesAggregator] listPagesDomains failed for ${p.name} (${account.name}): ${err}`);
        }
        const allDomains = Array.from(new Set([
          ...(p.domains && p.domains.length > 0 ? p.domains : [`${p.name}.pages.dev`]),
          ...extraDomains,
        ]));
        flat.push({
          account_id: account.id,
          account_name: account.name,
          account_email: account.email,
          cf_account_id: account.account_id,
          ...mapPageProject({ ...p, domains: allDomains }),
        });
      }));
    } catch (err: any) {
      console.error(`[PagesAggregator] detailed account ${account.name} (${account.id}) failed: ${err?.message || err}`);
    }
  }));

  return c.json({
    total_projects: flat.length,
    total_accounts: accounts.length,
    projects: flat,
  });
});

export default app;
