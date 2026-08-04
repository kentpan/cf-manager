import { Router, Request, Response, NextFunction } from 'express';
import { getActiveAccountsByFeature, getAccountById } from '../models/account';
import { listWorkers, listPages } from '../services/workerService';
import { appLogger } from '../services/logger';
import { getSetting } from '../db';

const router = Router();

/**
 * Aggregate Homepage — PUBLIC, UNAUTHENTICATED.
 *
 * Mounted BEFORE the authMiddleware in index.ts so anyone (including
 * visitors without API_SECRET) can load the portfolio/demo landing page.
 *
 * Reads the user-curated config from app_settings.aggregate_homepage
 * (set via PUT /api/settings/aggregate-homepage in the admin UI), then
 * resolves the live entry URL for each selected Workers/Pages project.
 *
 * The frontend renders this as a standalone Vue route at `/` (root) when
 * the aggregate homepage is enabled; when disabled, `/` redirects to the
 * admin dashboard (configured baseURL).
 *
 * Response shape:
 *   {
 *     enabled: boolean,
 *     theme: 'default' | 'brutalism',
 *     title: string,
 *     subtitle: string,
 *     items: Array<{
 *       display_name: string,
 *       type: 'worker' | 'pages',
 *       account_name: string,
 *       url: string,                // custom_url if set, else first custom domain, else <name>.<account_subdomain>.workers.dev / pages.dev
 *       sort_order: number,
 *     }>,
 *   }
 *
 * If the aggregate homepage is disabled, returns enabled=false with empty
 * items so the frontend can redirect to the admin dashboard.
 */

const AGGREGATE_HOMEPAGE_KEY = 'aggregate_homepage';

interface AggregateHomepageItem {
  account_id: number;
  worker_name: string;
  type: 'worker' | 'pages';
  display_name: string;
  sort_order: number;
  custom_url?: string;
}
interface AggregateHomepageConfig {
  enabled: boolean;
  theme: 'default' | 'brutalism';
  title: string;
  subtitle: string;
  items: AggregateHomepageItem[];
}

function readConfig(): AggregateHomepageConfig {
  const raw = getSetting(AGGREGATE_HOMEPAGE_KEY);
  const defaults: AggregateHomepageConfig = {
    enabled: false, theme: 'default', title: '作品集', subtitle: 'Projects & Demos', items: [],
  };
  if (!raw) return defaults;
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: !!parsed.enabled,
      theme: parsed.theme === 'brutalism' ? 'brutalism' : 'default',
      title: typeof parsed.title === 'string' ? parsed.title : defaults.title,
      subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : defaults.subtitle,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return defaults;
  }
}

const CF_BASE = 'https://api.cloudflare.com/client/v4';

/**
 * Get the workers.dev subdomain for an account. Cached per-request only
 * (no global cache because the subdomain rarely changes once set).
 */
async function getAccountSubdomain(accountId: string, authHeaders: Record<string, string>): Promise<string> {
  try {
    const resp = await fetch(`${CF_BASE}/accounts/${accountId}/workers/subdomain`, {
      headers: { 'Content-Type': 'application/json', ...authHeaders },
    });
    if (!resp.ok) return '';
    const json = await resp.json() as any;
    return json?.result?.subdomain || '';
  } catch {
    return '';
  }
}

/**
 * Resolve the canonical entry URL for a single Workers or Pages project.
 *
 * Priority (highest first):
 *   1. custom_url from the user's aggregate-homepage config (manual override)
 *   2. First custom domain registered on the project (via listPagesDomains
 *      for Pages, listDomains for Workers)
 *   3. <project>.<account-subdomain>.workers.dev (Workers) or
 *      <project>.pages.dev (Pages)
 *
 * The custom-domain lookup is best-effort: if it fails (rate limit, perms),
 * we fall back to the *.workers.dev / *.pages.dev URL so the homepage never
 * loses an entry.
 */
async function resolveEntryUrl(
  account: any,
  workerName: string,
  type: 'worker' | 'pages',
  customUrl?: string,
): Promise<string> {
  if (customUrl) {
    return /^https?:\/\//i.test(customUrl) ? customUrl : `https://${customUrl}`;
  }

  const authHeaders: Record<string, string> = {};
  // Reuse the auth headers from cfFactory — we don't import it directly to
  // avoid a circular import (cfFactory imports from logger, which is fine,
  // but keep this module self-contained for clarity).
  const { getAuthHeaders } = await import('../services/cfFactory');
  Object.assign(authHeaders, getAuthHeaders(account));

  if (type === 'pages') {
    // Pages projects carry `domains` (custom domains + canonical pages.dev)
    // directly on the project object, so we just list them.
    try {
      const projects = await listPages(account);
      const proj = projects.find(p => p.name === workerName);
      if (proj) {
        const domains = (proj as any).domains || [];
        // Prefer the first non-pages.dev domain (custom domain); fallback
        // to the canonical pages.dev subdomain.
        const customDomain = domains.find((d: string) => !d.endsWith('.pages.dev'));
        const picked = customDomain || domains[0] || `${workerName}.pages.dev`;
        return /^https?:\/\//i.test(picked) ? picked : `https://${picked}`;
      }
    } catch (e) {
      appLogger.warn(`[AggregateHomepage] resolveEntryUrl pages ${workerName}: ${e}`);
    }
    return `https://${workerName}.pages.dev`;
  }

  // Worker — try custom domains via the SDK, fallback to workers.dev subdomain.
  try {
    const { listDomains } = await import('../services/workerService');
    const domains = await listDomains(account, workerName);
    if (domains && domains.length > 0) {
      const d = (domains[0] as any).hostname || domains[0];
      return /^https?:\/\//i.test(d) ? d : `https://${d}`;
    }
  } catch (e) {
    appLogger.warn(`[AggregateHomepage] resolveEntryUrl worker ${workerName} domains: ${e}`);
  }

  // Fallback: <worker>.<account-subdomain>.workers.dev
  const subdomain = await getAccountSubdomain(account.account_id!, authHeaders);
  if (subdomain) {
    return `https://${workerName}.${subdomain}.workers.dev`;
  }
  return `https://${workerName}.workers.dev`;
}

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cfg = readConfig();
    if (!cfg.enabled) {
      // Homepage disabled — frontend will redirect to the admin dashboard.
      res.json({ enabled: false, theme: cfg.theme, title: cfg.title, subtitle: cfg.subtitle, items: [] });
      return;
    }

    // Resolve each selected item to a live URL. We do this in parallel
    // (Promise.all) so the homepage loads fast even with 10+ items.
    const allAccounts = getActiveAccountsByFeature('workers');
    const accountMap = new Map(allAccounts.map(a => [a.id, a]));

    const items = await Promise.all(cfg.items.map(async (it) => {
      const account = accountMap.get(it.account_id);
      if (!account) {
        // Account was deleted after the user added it to the homepage — skip.
        return null;
      }
      try {
        const url = await resolveEntryUrl(account, it.worker_name, it.type, it.custom_url);
        return {
          display_name: it.display_name || it.worker_name,
          type: it.type,
          account_name: account.name,
          url,
          sort_order: it.sort_order,
        };
      } catch (e: any) {
        appLogger.warn(`[AggregateHomepage] resolve failed for ${it.worker_name} (account ${it.account_id}): ${e?.message || e}`);
        // Don't break the whole homepage for one bad item — return a
        // best-effort fallback so the card still renders.
        const fallback = it.type === 'pages'
          ? `https://${it.worker_name}.pages.dev`
          : `https://${it.worker_name}.workers.dev`;
        return {
          display_name: it.display_name || it.worker_name,
          type: it.type,
          account_name: account.name,
          url: fallback,
          sort_order: it.sort_order,
        };
      }
    }));

    const filtered = items
      .filter((x): x is { display_name: string; type: 'worker' | 'pages'; account_name: string; url: string; sort_order: number } => x !== null)
      .sort((a, b) => a.sort_order - b.sort_order);

    res.json({
      enabled: true,
      theme: cfg.theme,
      title: cfg.title,
      subtitle: cfg.subtitle,
      items: filtered,
    });
  } catch (err) { next(err); }
});

export default router;
