import { Router, Request, Response, NextFunction } from 'express';
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
 *       title?: string,          // page <title> (auto-fetched via browser-render)
 *       description?: string,    // page meta description (auto-fetched)
 *       screenshot?: string,      // screenshot URL (uploaded to image host)
 *     }>,
 *     image_upload: {              // image host config for screenshots
 *       enabled: boolean,
 *       api_url: string,           // e.g. https://i.xubaoge.com/upload?authCode={{authCode}}&uploadChannel=cfr2&uploadNameType={{uploadNameType}}&uploadFolder={{uploadFolder}}
 *       api_key: string,           // Bearer token
 *       auth_code: string,         // {{authCode}} template value
 *       cdn_host: string,          // e.g. https://i.xubaoge.com
 *       r2_prefix: string,         // e.g. /cfmgr
 *     }
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
  title?: string;
  description?: string;
  screenshot?: string;
}
interface ImageUploadConfig {
  enabled: boolean;
  api_url: string;
  api_key: string;
  auth_code: string;
  cdn_host: string;
  r2_prefix: string;
}
interface AggregateHomepageConfig {
  enabled: boolean;
  theme: 'default' | 'brutalism';
  title: string;
  subtitle: string;
  items: AggregateHomepageItem[];
  image_upload: ImageUploadConfig;
}
const DEFAULT_AGGREGATE_CONFIG: AggregateHomepageConfig = {
  enabled: false,
  theme: 'default',
  title: '作品集',
  subtitle: 'Projects & Demos',
  items: [],
  image_upload: {
    enabled: false,
    api_url: 'https://i.xubaoge.com/upload?authCode={{authCode}}&uploadChannel=cfr2&uploadNameType={{uploadNameType}}&uploadFolder={{uploadFolder}}',
    api_key: '',
    auth_code: '',
    cdn_host: 'https://i.xubaoge.com',
    r2_prefix: '/cfmgr',
  },
};

function getAggregateConfig(): AggregateHomepageConfig {
  const raw = getSetting(AGGREGATE_HOMEPAGE_KEY);
  if (!raw) return { ...DEFAULT_AGGREGATE_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    const imgUpload = parsed.image_upload || {};
    return {
      enabled: !!parsed.enabled,
      theme: parsed.theme === 'brutalism' ? 'brutalism' : 'default',
      title: typeof parsed.title === 'string' ? parsed.title : DEFAULT_AGGREGATE_CONFIG.title,
      subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : DEFAULT_AGGREGATE_CONFIG.subtitle,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      image_upload: {
        enabled: !!imgUpload.enabled,
        api_url: typeof imgUpload.api_url === 'string' ? imgUpload.api_url : DEFAULT_AGGREGATE_CONFIG.image_upload.api_url,
        api_key: typeof imgUpload.api_key === 'string' ? imgUpload.api_key : '',
        auth_code: typeof imgUpload.auth_code === 'string' ? imgUpload.auth_code : '',
        cdn_host: typeof imgUpload.cdn_host === 'string' ? imgUpload.cdn_host : DEFAULT_AGGREGATE_CONFIG.image_upload.cdn_host,
        r2_prefix: typeof imgUpload.r2_prefix === 'string' ? imgUpload.r2_prefix : DEFAULT_AGGREGATE_CONFIG.image_upload.r2_prefix,
      },
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
    // Preserve title/description/screenshot when provided so the
    // fetch-screenshot endpoint can update them without losing the
    // rest of the config.
    cfg.items = body.items
      .filter((it: any) => it && typeof it.account_id === 'number' && typeof it.worker_name === 'string')
      .map((it: any, idx: number) => ({
        account_id: Number(it.account_id),
        worker_name: String(it.worker_name),
        type: it.type === 'pages' ? 'pages' : 'worker',
        display_name: typeof it.display_name === 'string' ? it.display_name : String(it.worker_name),
        sort_order: typeof it.sort_order === 'number' ? it.sort_order : idx,
        ...(typeof it.custom_url === 'string' && it.custom_url ? { custom_url: it.custom_url } : {}),
        ...(typeof it.title === 'string' ? { title: it.title } : {}),
        ...(typeof it.description === 'string' ? { description: it.description } : {}),
        ...(typeof it.screenshot === 'string' ? { screenshot: it.screenshot } : {}),
      }))
      .sort((a: AggregateHomepageItem, b: AggregateHomepageItem) => a.sort_order - b.sort_order);
  }
  // Image upload config for screenshots
  if (body.image_upload && typeof body.image_upload === 'object') {
    const iu = body.image_upload;
    if (typeof iu.enabled === 'boolean') cfg.image_upload.enabled = iu.enabled;
    if (typeof iu.api_url === 'string') cfg.image_upload.api_url = iu.api_url;
    if (typeof iu.api_key === 'string') cfg.image_upload.api_key = iu.api_key;
    if (typeof iu.auth_code === 'string') cfg.image_upload.auth_code = iu.auth_code;
    if (typeof iu.cdn_host === 'string') cfg.image_upload.cdn_host = iu.cdn_host;
    if (typeof iu.r2_prefix === 'string') cfg.image_upload.r2_prefix = iu.r2_prefix;
  }
  setAggregateConfig(cfg);
  res.json({ success: true, config: cfg });
});

// ============ Fetch screenshot + title + description ============
//
// Uses the built-in browser-render feature to navigate to a project's URL,
// capture a screenshot + extract <title> + <meta description>, then upload
// the screenshot to the configured image host and store the returned path
// back into the aggregate_homepage config for that item.
//
// This is triggered manually from the admin UI (the "抓取" button next to
// each item in the selection modal) so the user has full control over when
// the (potentially slow) browser-render call happens.
router.post('/aggregate-homepage/fetch-metadata', async (req, res, next: NextFunction) => {
  try {
    const { account_id, worker_name } = req.body || {};
    if (typeof account_id !== 'number' || typeof worker_name !== 'string') {
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'account_id (number) + worker_name (string) 必填' } });
      return;
    }
    const cfg = getAggregateConfig();
    const item = cfg.items.find(it => it.account_id === account_id && it.worker_name === worker_name);
    if (!item) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '该项目未在聚合首页配置中' } });
      return;
    }

    // Resolve the live URL for this item. We reuse the aggregate-homepage
    // route's resolver logic by importing it lazily (avoids circular import
    // at module load time).
    let targetUrl = item.custom_url || '';
    if (!targetUrl) {
      // Fall back to the canonical workers.dev / pages.dev URL
      targetUrl = item.type === 'pages'
        ? `https://${item.worker_name}.pages.dev`
        : `https://${item.worker_name}.workers.dev`;
    } else if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = `https://${targetUrl}`;
    }

    // Find the Cloudflare account that OWNS this project (by account_id)
    // so we use that account's browser-render quota, not a random one.
    // This avoids 429 rate-limit errors when one account is hammered by
    // all projects' screenshot captures.
    const { getAccountById } = await import('../models/account');
    const projectAccount = getAccountById(item.account_id);
    if (!projectAccount || !projectAccount.account_id) {
      res.status(400).json({ error: { code: 'ACCOUNT_NOT_FOUND', message: '项目所属账号不存在或未配置 account_id' } });
      return;
    }
    // Check that the account has browser_render feature enabled
    const { hasFeature } = await import('../models/account');
    if (!hasFeature(projectAccount, 'browser_render')) {
      res.status(400).json({ error: { code: 'NO_BROWSER_FEATURE', message: `账号「${projectAccount.name}」未启用 browser_render 功能，请在「账号管理」中开启` } });
      return;
    }
    const browserAccount = projectAccount;

    let pageTitle = '';
    let pageDescription = '';
    let screenshotPath = item.screenshot || '';
    let htmlFetchError = '';
    let screenshotError = '';

    // 1. Fetch the page HTML via browser-render 'content' mode to extract
    //    <title> + <meta name="description">. This is a single API call
    //    that returns the rendered HTML (after JS execution).
    try {
      const { renderPage } = await import('../services/browserRenderService');
      const htmlResult = await renderPage(browserAccount, targetUrl, 'content');
      const html = htmlResult.html || '';
      // Extract <title>
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      pageTitle = titleMatch ? titleMatch[1].trim().slice(0, 200) : '';
      // Extract <meta name="description" content="...">
      const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
      pageDescription = descMatch ? descMatch[1].trim().slice(0, 300) : '';
    } catch (e: any) {
      htmlFetchError = e?.message || String(e);
      console.warn(`[fetch-metadata] HTML fetch failed for ${targetUrl}: ${htmlFetchError}`);
    }

    // 2. Capture screenshot via browser-render 'screenshot' mode + upload
    //    to the configured image host. Run this even if image_upload is not
    //    enabled — if disabled we just skip the upload but still log whether
    //    the screenshot API call itself worked.
    if (cfg.image_upload.enabled && cfg.image_upload.api_url && cfg.image_upload.api_key) {
      try {
        const { renderPage } = await import('../services/browserRenderService');
        const screenshotResult = await renderPage(browserAccount, targetUrl, 'screenshot');
        if (screenshotResult.screenshot) {
          const base64Data = screenshotResult.screenshot.replace(/^data:image\/png;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          screenshotPath = await uploadScreenshotToImageHost(buffer, cfg.image_upload, worker_name);
        } else {
          screenshotError = 'browser-render 返回空截图数据';
        }
      } catch (e: any) {
        screenshotError = e?.message || String(e);
        console.warn(`[fetch-metadata] screenshot capture/upload failed for ${targetUrl}: ${screenshotError}`);
      }
    } else {
      screenshotError = '图床未启用或缺少 api_url / api_key 配置';
    }

    // Update the item with the fetched metadata
    item.title = pageTitle;
    item.description = pageDescription;
    if (screenshotPath && !screenshotError) item.screenshot = screenshotPath;
    setAggregateConfig(cfg);

    // Return detailed status so the frontend can show what succeeded/failed
    // and offer per-item retry for title/description vs screenshot.
    res.json({
      success: true,
      item: {
        account_id: item.account_id,
        worker_name: item.worker_name,
        title: item.title,
        description: item.description,
        screenshot: item.screenshot,
        screenshot_url: item.screenshot ? resolveImageUrl(item.screenshot, cfg.image_upload.cdn_host) : '',
      },
      status: {
        html_ok: !htmlFetchError,
        html_error: htmlFetchError || '',
        screenshot_ok: !screenshotError && !!screenshotPath,
        screenshot_error: screenshotError || '',
        target_url: targetUrl,
      },
    });
  } catch (err) { next(err); }
});

/**
 * Upload a screenshot buffer to the configured image host.
 * Mirrors the image-upload.ts service: parses the {{authCode}} / {{uploadFolder}}
 * / {{uploadNameType}} template, POSTs as multipart/form-data, extracts the
 * returned path.
 */
async function uploadScreenshotToImageHost(buffer: Buffer, iu: ImageUploadConfig, workerName: string): Promise<string> {
  const uploadFolder = (iu.r2_prefix || '/cfmgr').replace(/^\//, '');
  const uploadUrl = iu.api_url
    .replace(/\{\{authCode\}\}/g, encodeURIComponent(iu.auth_code || ''))
    .replace(/\{\{uploadNameType\}\}/g, 'short')
    .replace(/\{\{uploadFolder\}\}/g, encodeURIComponent(uploadFolder));

  const filename = `cfmgr-${workerName}-${Date.now()}.png`;
  const blob = new Blob([new Uint8Array(buffer)], { type: 'image/png' });
  const formData = new FormData();
  formData.append('file', blob, filename);

  const resp = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
    headers: { Authorization: `Bearer ${iu.api_key}` },
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`图床上传失败: HTTP ${resp.status} ${txt.slice(0, 200)}`);
  }
  const result: any = await resp.json().catch(() => ({}));
  // Parse the upload result to extract the file path. Mirrors
  // image-upload.ts parseUploadResult.
  let filePath: string | undefined;
  if (Array.isArray(result)) {
    filePath = result[0]?.src;
  } else {
    const dataNode = result?.data;
    filePath = result?.fileId || dataNode?.fileId || dataNode?.id || dataNode?.url || result?.url;
  }
  if (!filePath) throw new Error('图床上传失败, 未返回文件路径');
  // If the host returned a full URL, extract the pathname
  if (filePath.startsWith('http')) {
    try { return new URL(filePath).pathname; } catch { /* fall through */ }
  }
  return /^\//.test(filePath) ? filePath : '/' + filePath;
}

/** Resolve a stored path to a full URL using the configured CDN host. */
function resolveImageUrl(path: string, cdnHost: string): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  if (!cdnHost) return path;
  const cleanHost = cdnHost.replace(/\/+$/, '');
  return `${cleanHost}${/^\//.test(path) ? path : '/' + path}`;
}

export default router;
