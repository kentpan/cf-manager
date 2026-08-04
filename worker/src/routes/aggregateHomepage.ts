import { Hono } from 'hono';
import type { Env } from '../types';
import { getSetting } from '../db/models';
import { getAuthHeaders, cfFetch } from '../services/cfApi';
import type { Account } from '../db/models';

const app = new Hono<{ Bindings: Env }>();

/**
 * Aggregate Homepage — PUBLIC, UNAUTHENTICATED.
 *
 * Mounted BEFORE authMiddleware in index.ts so anyone (including visitors
 * without API_SECRET) can load the portfolio/demo landing page at the
 * root path. Mirrors the Node backend's /api/aggregate-homepage route.
 *
 * Reads the user-curated config from app_settings.aggregate_homepage
 * (set via PUT /api/settings/aggregate-homepage in the admin UI), then
 * resolves the live entry URL for each selected Workers/Pages project.
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

async function readConfig(env: Env): Promise<AggregateHomepageConfig> {
  const defaults: AggregateHomepageConfig = {
    enabled: false, theme: 'default', title: '作品集', subtitle: 'Projects & Demos', items: [],
  };
  const raw = await getSetting(env.DB, AGGREGATE_HOMEPAGE_KEY);
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
 * Resolve the canonical entry URL for a single Workers or Pages project.
 * Priority (highest first):
 *   1. custom_url from the user's aggregate-homepage config (manual override)
 *   2. First custom domain registered on the project
 *   3. <project>.<account-subdomain>.workers.dev (Workers) or
 *      <project>.pages.dev (Pages)
 */
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
      // List Pages projects and find the one we want.
      const resp = await cfFetch<{ result: any[] }>(account, `/accounts/${account.account_id}/pages/projects`, encryptionKey);
      const projects = resp.result || [];
      const proj = projects.find((p: any) => p.name === workerName);
      if (proj) {
        const domains = proj.domains || [];
        const customDomain = domains.find((d: string) => !d.endsWith('.pages.dev'));
        const picked = customDomain || domains[0] || `${workerName}.pages.dev`;
        return /^https?:\/\//i.test(picked) ? picked : `https://${picked}`;
      }
    } catch (e) {
      console.warn(`[AggregateHomepage] resolveEntryUrl pages ${workerName}: ${e}`);
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
    console.warn(`[AggregateHomepage] resolveEntryUrl worker ${workerName} domains: ${e}`);
  }

  // Fallback: <worker>.<account-subdomain>.workers.dev
  const subdomain = await getAccountSubdomain(account, encryptionKey);
  if (subdomain) {
    return `https://${workerName}.${subdomain}.workers.dev`;
  }
  return `https://${workerName}.workers.dev`;
}

/**
 * Get the workers.dev subdomain for an account via the CF REST API.
 */
async function getAccountSubdomain(account: Account, encryptionKey: string): Promise<string> {
  try {
    const authHeaders = await getAuthHeaders(account, encryptionKey);
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

/**
 * Load all active accounts with the 'workers' feature from the D1 accounts
 * table. Mirrors the Node backend's getActiveAccountsByFeature.
 */
async function getActiveWorkersAccounts(env: Env): Promise<Account[]> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, account_id, auth_type, api_token, api_key, email, enabled_features, password, available_features, proxy_url, proxy_enabled, is_active, created_at, updated_at
       FROM accounts WHERE is_active = 1 ORDER BY created_at DESC`
    ).all();
    return (results || []).filter((a: any) => {
      const features = (a.enabled_features || '').split(',');
      return features.includes('workers');
    }) as Account[];
  } catch (e) {
    console.error('[AggregateHomepage] getActiveWorkersAccounts:', e);
    return [];
  }
}

app.get('/', async (c) => {
  const cfg = await readConfig(c.env);
  if (!cfg.enabled) {
    // Homepage disabled — frontend will redirect to the admin dashboard.
    return c.json({ enabled: false, theme: cfg.theme, title: cfg.title, subtitle: cfg.subtitle, items: [] });
  }

  const allAccounts = await getActiveWorkersAccounts(c.env);
  const accountMap = new Map(allAccounts.map(a => [a.id, a]));

  // Resolve each selected item to a live URL in parallel.
  const items = await Promise.all(cfg.items.map(async (it) => {
    const account = accountMap.get(it.account_id);
    if (!account || !account.account_id) {
      return null;
    }
    try {
      const url = await resolveEntryUrl(account, c.env.ENCRYPTION_KEY, it.worker_name, it.type, it.custom_url);
      return {
        display_name: it.display_name || it.worker_name,
        type: it.type,
        account_name: account.name,
        url,
        sort_order: it.sort_order,
      };
    } catch (e: any) {
      console.warn(`[AggregateHomepage] resolve failed for ${it.worker_name} (account ${it.account_id}): ${e?.message || e}`);
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

  return c.json({
    enabled: true,
    theme: cfg.theme,
    title: cfg.title,
    subtitle: cfg.subtitle,
    items: filtered,
  });
});

export default app;
