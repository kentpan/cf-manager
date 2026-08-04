import { Router, Request, Response, NextFunction } from 'express';
import { getActiveAccountsByFeature } from '../models/account';
import { listPages, listPagesDomains } from '../services/workerService';
import { appLogger } from '../services/logger';
import { DecryptError } from '../services/cfFactory';

const router = Router();

/**
 * Format a per-account failure so the aggregator response is informative
 * without leaking ciphertext fragments. DecryptError gets a dedicated,
 * actionable message because the recovery (reset credentials + re-enter)
 * is different from a generic Cloudflare API failure.
 */
function formatAccountError(err: any): { error: string; error_kind: 'decrypt' | 'api' } {
  if (err instanceof DecryptError) {
    return {
      error: '凭证解密失败：当前 ENCRYPTION_KEY 与数据库中存储的密文不匹配。请重置后重新录入 API 凭证。',
      error_kind: 'decrypt',
    };
  }
  return { error: err?.message || String(err), error_kind: 'api' };
}

/**
 * Pages Aggregator
 * ----------------
 * Cross-account aggregated view of every Cloudflare Pages project reachable
 * from the configured accounts in this CF Manager instance.
 *
 * Each entry exposes the deployment entry points (`domains` plus the
 * canonical `<project>.pages.dev` URL), so the management UI can render a
 * single launchpad of all Pages services regardless of which account owns
 * them.
 *
 * Errors are tracked per-account: a failure for one account does not break
 * the whole list. The caller gets back a `failedAccounts` array so the UI
 * can surface the cause.
 */
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const accounts = getActiveAccountsByFeature('workers');

    const perAccount = await Promise.all(accounts.map(async (account) => {
      try {
        const projects = await listPages(account);
        return {
          account_id: account.id,
          account_name: account.name,
          account_email: account.email,
          cf_account_id: account.account_id,
          projects: projects.map(p => ({
            id: p.id,
            name: p.name,
            // Cloudflare returns the canonical `<project>.pages.dev` subdomain
            // inside `domains`. Some legacy projects may have an empty list,
            // so we always synthesise a fallback URL so the UI never loses
            // the entry point.
            domains: p.domains && p.domains.length > 0
              ? p.domains
              : [`${p.name}.pages.dev`],
            production_branch: p.production_branch,
            created_on: p.created_on,
            modified_on: p.modified_on,
            deployment_count: p.deployment_count,
            source: p.source,
          })),
          error: null as string | null,
          error_kind: null as 'decrypt' | 'api' | null,
        };
      } catch (err: any) {
        appLogger.error(`[PagesAggregator] account ${account.name} (${account.id}) failed: ${err?.message || err}`);
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

    // Flatten for convenience + provide a per-account breakdown so the UI can
    // group by account or render a single mixed list as needed.
    const flat = perAccount.flatMap(acc =>
      acc.projects.map(p => ({
        account_id: acc.account_id,
        account_name: acc.account_name,
        account_email: acc.account_email,
        cf_account_id: acc.cf_account_id,
        ...p,
      })),
    );

    res.json({
      total_projects: flat.length,
      total_accounts: accounts.length,
      healthy_accounts: perAccount.filter(a => !a.error).length,
      failed_accounts: perAccount
        .filter(a => a.error)
        .map(a => ({ account_id: a.account_id, account_name: a.account_name, error: a.error, error_kind: a.error_kind })),
      accounts: perAccount,
      projects: flat,
    });
  } catch (err) { next(err); }
});

/**
 * Optional deep-fetch: include custom domains registered on each project
 * (separate Cloudflare API call per project). Use only when the user
 * explicitly asks for the full domain inventory; the default endpoint above
 * already returns the canonical pages.dev domain for every project.
 */
router.get('/detailed', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const accounts = getActiveAccountsByFeature('workers');
    const flat: any[] = [];

    await Promise.all(accounts.map(async (account) => {
      try {
        const projects = await listPages(account);
        await Promise.all(projects.map(async (p) => {
          let extraDomains: string[] = [];
          try {
            const domainsResp = await listPagesDomains(account, p.name);
            extraDomains = (domainsResp || []).map((d: any) => d.name).filter(Boolean);
          } catch (err) {
            appLogger.warn(`[PagesAggregator] listPagesDomains failed for ${p.name} (${account.name}): ${err}`);
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
            id: p.id,
            name: p.name,
            domains: allDomains,
            production_branch: p.production_branch,
            created_on: p.created_on,
            modified_on: p.modified_on,
            deployment_count: p.deployment_count,
            source: p.source,
          });
        }));
      } catch (err: any) {
        appLogger.error(`[PagesAggregator] account ${account.name} (${account.id}) failed: ${err?.message || err}`);
      }
    }));

    res.json({
      total_projects: flat.length,
      total_accounts: accounts.length,
      projects: flat,
    });
  } catch (err) { next(err); }
});

export default router;
