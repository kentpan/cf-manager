import { Router } from 'express';
import { config, isEnvWritable, readEnvFile, writeEnvFile } from '../config';
import { clearCache } from '../services/accountRouter';
import { clearClientCache } from '../services/cfFactory';
import { getProxyUrl, setProxyUrl, isProxyEnabled, setProxyEnabled, testProxyConnection } from '../services/proxyService';
import { VERSION, GIT_COMMIT } from '../version';
import { getSetting, setSetting } from '../db';

const router = Router();

/**
 * Aggregate homepage config.
 *
 * Stored in app_settings under a single JSON key so the public route can
 * read it without joining multiple tables. Shape:
 *
 *   {
 *     enabled: boolean,
 *     theme: 'default' | 'brutalism',
 *     title: string,            // custom homepage title (default: '作品集')
 *     subtitle: string,         // custom subtitle
 *     items: Array<{
 *       account_id: number,
 *       worker_name: string,
 *       type: 'worker' | 'pages',
 *       display_name: string,   // custom label (defaults to worker_name)
 *       sort_order: number,
 *       custom_url?: string,     // override the auto-picked link
 *     }>
 *   }
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

function getAggregateConfig(): AggregateHomepageConfig {
  const raw = getSetting(AGGREGATE_HOMEPAGE_KEY);
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

function setAggregateConfig(cfg: AggregateHomepageConfig): void {
  setSetting(AGGREGATE_HOMEPAGE_KEY, JSON.stringify(cfg));
}

router.get('/', (_req, res) => {
  res.json({
    encryption_key_configured: !!config.encryptionKey,
    api_secret_configured: !!config.apiSecret,
    demo_account_ids: config.demoAccountIds || '',
    db_path: config.dbPath,
    proxy_url: getProxyUrl(),
    proxy_enabled: isProxyEnabled(),
    platform: 'node-backend',
    version: VERSION,
    git_commit: GIT_COMMIT,
    base_url: config.baseUrl,
    is_cloudflare_edge: config.isCloudflareEdge,
    env_writable: isEnvWritable(),
  });
});

router.post('/cache/clear', (_req, res) => {
  clearCache();
  clearClientCache();
  res.json({ success: true, message: 'All caches cleared (zones, quota, SDK clients)' });
});

router.put('/proxy', (req, res) => {
  const { proxy_url, proxy_enabled } = req.body;
  if (proxy_url !== undefined) {
    if (typeof proxy_url !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'proxy_url must be a string' } });
      return;
    }
    setProxyUrl(proxy_url);
  }
  if (proxy_enabled !== undefined) {
    setProxyEnabled(!!proxy_enabled);
  }
  clearClientCache();
  res.json({ success: true, proxy_url: getProxyUrl(), proxy_enabled: isProxyEnabled() });
});

router.post('/proxy/test', async (req, res) => {
  const { proxy_url } = req.body;
  const url = typeof proxy_url === 'string' ? proxy_url : getProxyUrl();
  if (!url) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No proxy URL to test' } });
    return;
  }
  try {
    const result = await testProxyConnection(url);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(502).json({ error: { code: 'PROXY_TEST_FAILED', message: err.message || 'Proxy test failed' } });
  }
});

// ============ baseURL config ============
//
// On Node: writes BASE_URL=<value> to .env and asks the user to restart the
// backend so vue-router picks up the new path.
//
// On Cloudflare edge: returns 400 with a hint that BASE_URL must be set
// in wrangler.toml [vars] (or the CF Pages dashboard) and the project
// redeployed — there's no filesystem to write to.
router.put('/base-url', (req, res) => {
  const { base_url } = req.body || {};
  if (typeof base_url !== 'string') {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'base_url must be a string' } });
    return;
  }
  // Normalise: empty or '/' means root. Anything else must start and end
  // with '/' (vue-router base format).
  let normalized = base_url.trim() || '/';
  if (normalized !== '/') {
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    if (!normalized.endsWith('/')) normalized = normalized + '/';
  }

  if (config.isCloudflareEdge) {
    res.status(400).json({
      error: {
        code: 'EDGE_NO_FS',
        message: 'Cloudflare 边缘运行时无法写入 .env。请前往 Cloudflare Pages 项目 → Settings → Environment variables → 修改 BASE_URL, 然后 Redeploy。',
      },
    });
    return;
  }
  if (!isEnvWritable()) {
    res.status(400).json({
      error: {
        code: 'ENV_NOT_WRITABLE',
        message: `.env 文件不可写 (路径: ${config.envPath})。请手动编辑该文件并设置 BASE_URL=${normalized}, 然后重启后端。`,
      },
    });
    return;
  }

  // Read existing .env, update BASE_URL, write back. Preserves every other
  // key the user has set (ENCRYPTION_KEY, API_SECRET, PROXY_URL, ...).
  const envMap = readEnvFile();
  envMap.BASE_URL = normalized;
  try {
    writeEnvFile(envMap);
  } catch (e: any) {
    res.status(500).json({ error: { code: 'ENV_WRITE_FAILED', message: `写入 .env 失败: ${e?.message || e}` } });
    return;
  }

  res.json({
    success: true,
    base_url: normalized,
    message: 'BASE_URL 已写入 .env。请重启后端让 vue-router 加载新路径。',
  });
});

// ============ Aggregate homepage config ============
//
// The aggregate homepage is a public, unauthenticated landing page that
// shows a curated list of Workers + Pages projects as a portfolio/demo
// showcase. Config is stored as a single JSON blob in app_settings; the
// public route reads it without auth.

router.get('/aggregate-homepage', (_req, res) => {
  res.json(getAggregateConfig());
});

router.put('/aggregate-homepage', (req, res) => {
  const cfg = getAggregateConfig();
  const body = req.body || {};
  if (typeof body.enabled === 'boolean') cfg.enabled = body.enabled;
  if (body.theme === 'default' || body.theme === 'brutalism') cfg.theme = body.theme;
  if (typeof body.title === 'string') cfg.title = body.title.slice(0, 100);
  if (typeof body.subtitle === 'string') cfg.subtitle = body.subtitle.slice(0, 200);
  if (Array.isArray(body.items)) {
    // Validate each item; drop malformed entries silently.
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
  setAggregateConfig(cfg);
  res.json({ success: true, config: cfg });
});

export default router;
