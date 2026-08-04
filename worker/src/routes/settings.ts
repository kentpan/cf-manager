import { Hono } from 'hono';
import type { Env } from '../types';
import { getSetting, setSetting, getAccountById, hasFeature } from '../db/models';
import { getAuthHeaders, cfFetch } from '../services/cfApi';
import type { Account } from '../db/models';
import { VERSION, GIT_COMMIT } from '../version';

const app = new Hono<{ Bindings: Env }>();

/**
 * Aggregate homepage config (mirrors the Node backend's implementation).
 *
 * Stored in app_settings under a single JSON key. Shape:
 *   {
 *     enabled, theme, title, subtitle,
 *     items: Array<{ account_id, worker_name, type, display_name, sort_order,
 *                    custom_url?, title?, description?, screenshot? }>,
 *     image_upload: { enabled, api_url, api_key, auth_code, cdn_host, r2_prefix }
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

async function getAggregateConfig(env: Env): Promise<AggregateHomepageConfig> {
  const raw = await getSetting(env.DB, AGGREGATE_HOMEPAGE_KEY);
  if (!raw) return { ...DEFAULT_AGGREGATE_CONFIG };
  try {
    const parsed = JSON.parse(raw);
    const iu = parsed.image_upload || {};
    return {
      enabled: !!parsed.enabled,
      theme: parsed.theme === 'brutalism' ? 'brutalism' : 'default',
      title: typeof parsed.title === 'string' ? parsed.title : DEFAULT_AGGREGATE_CONFIG.title,
      subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : DEFAULT_AGGREGATE_CONFIG.subtitle,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      image_upload: {
        enabled: !!iu.enabled,
        api_url: typeof iu.api_url === 'string' ? iu.api_url : DEFAULT_AGGREGATE_CONFIG.image_upload.api_url,
        api_key: typeof iu.api_key === 'string' ? iu.api_key : '',
        auth_code: typeof iu.auth_code === 'string' ? iu.auth_code : '',
        cdn_host: typeof iu.cdn_host === 'string' ? iu.cdn_host : DEFAULT_AGGREGATE_CONFIG.image_upload.cdn_host,
        r2_prefix: typeof iu.r2_prefix === 'string' ? iu.r2_prefix : DEFAULT_AGGREGATE_CONFIG.image_upload.r2_prefix,
      },
    };
  } catch {
    return { ...DEFAULT_AGGREGATE_CONFIG };
  }
}

async function setAggregateConfig(env: Env, cfg: AggregateHomepageConfig): Promise<void> {
  await setSetting(env.DB, AGGREGATE_HOMEPAGE_KEY, JSON.stringify(cfg));
}

/** Resolve a stored path to a full URL using the configured CDN host. */
function resolveImageUrl(path: string, cdnHost: string): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  if (!cdnHost) return path;
  const cleanHost = cdnHost.replace(/\/+$/, '');
  return `${cleanHost}${/^\//.test(path) ? path : '/' + path}`;
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
    base_url: '/',
    is_cloudflare_edge: true,
    env_writable: false,
  });
});

app.post('/cache/clear', (c) => {
  return c.json({ message: 'Worker is stateless — no persistent cache to clear' });
});

// ============ baseURL config ============
app.put('/base-url', (c) => {
  return c.json({
    error: {
      code: 'EDGE_NO_FS',
      message: 'Cloudflare 边缘运行时无法写入 .env。请前往 Cloudflare Pages 项目 → Settings → Environment variables → 修改 BASE_URL, 然后 Redeploy。',
    },
  }, 400);
});

// ============ Aggregate homepage config ============

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
  await setAggregateConfig(c.env, cfg);
  return c.json({ success: true, config: cfg });
});

// ============ Fetch screenshot + title + description ============
//
// Uses Cloudflare Browser Rendering API to navigate to a project's URL,
// capture a screenshot + extract <title> + <meta description>, then upload
// the screenshot to the configured image host and store the returned path
// back into the aggregate_homepage config for that item.
app.post('/aggregate-homepage/fetch-metadata', async (c) => {
  const { account_id, worker_name } = await c.req.json().catch(() => ({}));
  if (typeof account_id !== 'number' || typeof worker_name !== 'string') {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'account_id (number) + worker_name (string) 必填' } }, 400);
  }

  const cfg = await getAggregateConfig(c.env);
  const item = cfg.items.find(it => it.account_id === account_id && it.worker_name === worker_name);
  if (!item) {
    return c.json({ error: { code: 'NOT_FOUND', message: '该项目未在聚合首页配置中' } }, 404);
  }

  // Resolve the target URL
  let targetUrl = item.custom_url || '';
  if (!targetUrl) {
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
  const { getAccountById, hasFeature } = await import('../db/models');
  const projectAccount = await getAccountById(c.env.DB, item.account_id);
  if (!projectAccount || !projectAccount.account_id) {
    return c.json({ error: { code: 'ACCOUNT_NOT_FOUND', message: '项目所属账号不存在或未配置 account_id' } }, 400);
  }
  if (!hasFeature(projectAccount, 'browser_render')) {
    return c.json({ error: { code: 'NO_BROWSER_FEATURE', message: `账号「${projectAccount.name}」未启用 browser_render 功能，请在「账号管理」中开启` } }, 400);
  }

  let pageTitle = '';
  let pageDescription = '';
  let screenshotPath = item.screenshot || '';
  let htmlFetchError = '';
  let screenshotError = '';

  // 1. Fetch page HTML — call the internal /api/browser-render endpoint
  //    which handles rate limiting, token bucket, retry with backup
  //    accounts, and daily quota exhaustion. We pass accountId so it uses
  //    the project's own account. We also pass the API_SECRET auth header
  //    because /api/browser-render is behind authMiddleware.
  const internalHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (c.env.API_SECRET) {
    internalHeaders['Authorization'] = `Bearer ${c.env.API_SECRET}`;
  }
  const browserRenderUrl = new URL('/api/browser-render', c.req.url).toString();

  try {
    const htmlResp = await fetch(browserRenderUrl, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify({ url: targetUrl, mode: 'content', accountId: projectAccount.id }),
    });
    if (htmlResp.ok) {
      const htmlData = await htmlResp.json() as any;
      const html = htmlData?.html || htmlData?.result || '';
      const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      pageTitle = titleMatch ? titleMatch[1].trim().slice(0, 200) : '';
      const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
      pageDescription = descMatch ? descMatch[1].trim().slice(0, 300) : '';
    } else {
      const errData = await htmlResp.json().catch(() => ({}));
      htmlFetchError = errData?.error?.message || `HTTP ${htmlResp.status}`;
    }
  } catch (e: any) {
    htmlFetchError = e?.message || String(e);
    console.warn(`[fetch-metadata] HTML fetch failed for ${targetUrl}: ${htmlFetchError}`);
  }

  // 2. Capture screenshot — call the same internal /api/browser-render
  //    endpoint (with rate limiting + retry).
  if (cfg.image_upload.enabled && cfg.image_upload.api_url && cfg.image_upload.api_key) {
    try {
      const screenshotResp = await fetch(browserRenderUrl, {
        method: 'POST',
        headers: internalHeaders,
        body: JSON.stringify({ url: targetUrl, mode: 'screenshot', accountId: projectAccount.id }),
      });
      if (screenshotResp.ok) {
        const screenshotData = await screenshotResp.json() as any;
        const screenshotBase64 = screenshotData?.screenshot || screenshotData?.result?.screenshot || '';
        if (screenshotBase64) {
          const base64Data = screenshotBase64.replace(/^data:image\/png;base64,/, '');
          const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0)).buffer;
          screenshotPath = await uploadScreenshotToImageHost(buffer, cfg.image_upload, worker_name);
        } else {
          screenshotError = 'browser-render 返回空截图数据';
        }
      } else {
        const errData = await screenshotResp.json().catch(() => ({}));
        screenshotError = errData?.error?.message || `HTTP ${screenshotResp.status}`;
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
  await setAggregateConfig(c.env, cfg);

  // Return detailed status so the frontend can show what succeeded/failed
  // and offer per-item retry for title/description vs screenshot.
  return c.json({
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
});

/**
 * Upload a screenshot buffer to the configured image host.
 * Mirrors the image-upload.ts service: parses {{authCode}} / {{uploadFolder}}
 * / {{uploadNameType}} template, POSTs as multipart/form-data, extracts the
 * returned path.
 */
async function uploadScreenshotToImageHost(buffer: ArrayBuffer, iu: ImageUploadConfig, workerName: string): Promise<string> {
  const uploadFolder = (iu.r2_prefix || '/cfmgr').replace(/^\//, '');
  const uploadUrl = iu.api_url
    .replace(/\{\{authCode\}\}/g, encodeURIComponent(iu.auth_code || ''))
    .replace(/\{\{uploadNameType\}\}/g, 'short')
    .replace(/\{\{uploadFolder\}\}/g, encodeURIComponent(uploadFolder));

  const filename = `cfmgr-${workerName}-${Date.now()}.png`;
  const blob = new Blob([buffer], { type: 'image/png' });
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
  let filePath: string | undefined;
  if (Array.isArray(result)) {
    filePath = result[0]?.src;
  } else {
    const dataNode = result?.data;
    filePath = result?.fileId || dataNode?.fileId || dataNode?.id || dataNode?.url || result?.url;
  }
  if (!filePath) throw new Error('图床上传失败, 未返回文件路径');
  if (filePath.startsWith('http')) {
    try { return new URL(filePath).pathname; } catch { /* fall through */ }
  }
  return /^\//.test(filePath) ? filePath : '/' + filePath;
}

export default app;
