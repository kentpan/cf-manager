import { Hono } from 'hono';
import type { Env } from '../types';
import { getSetting, setSetting } from '../db/models';
import { VERSION, GIT_COMMIT } from '../version';

const app = new Hono<{ Bindings: Env }>();

/**
 * Aggregate homepage config (mirrors the Node backend's implementation).
 *
 * Stored in app_settings under a single JSON key so the public route can
 * read it without joining multiple tables. The public route (mounted
 * before authMiddleware in index.ts) serves this config + resolved entry
 * URLs so visitors see the portfolio/demo landing page.
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
const DEFAULT_AGGREGATE_CONFIG: AggregateHomepageConfig = {
  enabled: false,
  theme: 'default',
  title: '作品集',
  subtitle: 'Projects & Demos',
  items: [],
};

async function getAggregateConfig(env: Env): Promise<AggregateHomepageConfig> {
  const raw = await getSetting(env.DB, AGGREGATE_HOMEPAGE_KEY);
  if (!raw) return { ...DEFAULT_AGGREGATE_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: !!parsed.enabled,
      theme: parsed.theme === 'brutalism' ? 'brutalism' : 'default',
      title: typeof parsed.title === 'string' ? parsed.title : DEFAULT_AGGREGATE_CONFIG.title,
      subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : DEFAULT_AGGREGATE_CONFIG.subtitle,
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return { ...DEFAULT_AGGREGATE_CONFIG };
  }
}

async function setAggregateConfig(env: Env, cfg: AggregateHomepageConfig): Promise<void> {
  await setSetting(env.DB, AGGREGATE_HOMEPAGE_KEY, JSON.stringify(cfg));
}

app.get('/', (c) => {
  return c.json({
    encryption_key_configured: !!c.env.ENCRYPTION_KEY,
    api_secret_configured: !!c.env.API_SECRET,
    demo_account_ids: c.env.DEMO_ACCOUNT_IDS || '',
    db_path: 'D1 (Cloudflare)',
    platform: 'cloudflare-workers',
    version: VERSION,
    git_commit: GIT_COMMIT,
    // v1.0.4 — baseURL + env-writable status for the Settings UI. On the
    // Cloudflare edge runtime we cannot write .env (there's no filesystem),
    // so base_url is read-only and reflects whatever was set via the Pages
    // dashboard / wrangler.toml vars at deploy time. The Settings card uses
    // these fields to show the right UI (disabled input + hint).
    base_url: '/',
    is_cloudflare_edge: true,
    env_writable: false,
  });
});

app.post('/cache/clear', (c) => {
  return c.json({ message: 'Worker is stateless — no persistent cache to clear' });
});

// ============ baseURL config ============
//
// On Cloudflare edge there is no .env file to write — BASE_URL is set via
// the Pages dashboard (Settings → Environment variables) or wrangler.toml
// [vars] and requires a redeploy to take effect. We return a clear error
// so the Settings UI can show the user what to do.
app.put('/base-url', (c) => {
  return c.json({
    error: {
      code: 'EDGE_NO_FS',
      message: 'Cloudflare 边缘运行时无法写入 .env。请前往 Cloudflare Pages 项目 → Settings → Environment variables → 修改 BASE_URL, 然后 Redeploy。',
    },
  }, 400);
});

// ============ Aggregate homepage config ============
//
// Reads/writes the JSON blob in app_settings. The public route
// (GET /api/aggregate-homepage, mounted before authMiddleware) reads this
// same config + resolves live entry URLs.

app.get('/aggregate-homepage', async (c) => {
  const cfg = await getAggregateConfig(c.env);
  return c.json(cfg);
});

app.put('/aggregate-homepage', async (c) => {
  const cfg = await getAggregateConfig(c.env);
  const body = await c.req.json().catch(() => ({}));
  if (typeof body.enabled === 'boolean') cfg.enabled = body.enabled;
  if (body.theme === 'default' || body.theme === 'brutalism') cfg.theme = body.theme;
  if (typeof body.title === 'string') cfg.title = body.title.slice(0, 100);
  if (typeof body.subtitle === 'string') cfg.subtitle = body.subtitle.slice(0, 200);
  if (Array.isArray(body.items)) {
    cfg.items = body.items
      .filter((it: any) => it && typeof it.account_id === 'number' && typeof it.worker_name === 'string')
      .map((it: any, idx: number) => ({
        account_id: Number(it.account_id),
        worker_name: String(it.worker_name),
        type: it.type === 'pages' ? 'pages' : 'worker',
        display_name: typeof it.display_name === 'string' ? it.display_name : String(it.worker_name),
        sort_order: typeof it.sort_order === 'number' ? it.sort_order : idx,
        ...(typeof it.custom_url === 'string' && it.custom_url ? { custom_url: it.custom_url } : {}),
      }))
      .sort((a: AggregateHomepageItem, b: AggregateHomepageItem) => a.sort_order - b.sort_order);
  }
  await setAggregateConfig(c.env, cfg);
  return c.json({ success: true, config: cfg });
});

export default app;
