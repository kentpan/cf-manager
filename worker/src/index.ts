import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { v1ErrorHandler } from './middleware/v1ErrorHandler';
import { requestIdMiddleware } from './middleware/requestId';
import { responseWrapper } from './middleware/responseWrapper';
import { getRecentLogs, queryLogs, getDistinctActions, getSetting } from './db/models';
import { getEnabledCatalogSources, updateCatalogSource } from './db/models';
import { getQuotaSummary, syncUsageFromCloudflare, invalidateAiCache } from './services/quotaTracker';
import { getFakeNginxPage } from './pages/fakeNginx';

import accountsRouter from './routes/accounts';
import dnsRouter from './routes/dns';
import workersRouter from './routes/workers';
import storageRouter from './routes/storage';
import browserRenderRouter from './routes/browserRender';
import settingsRouter from './routes/settings';
import openaiRouter from './routes/openai';
import storeRouter from './routes/store';
import tunnelsRouter from './routes/tunnels';
import aiRouter from './routes/ai';
import aggregateHomepageRouter from './routes/aggregateHomepage';
import domainProvidersRouter from './routes/domainProviders';
import pagesAggregatorRouter from './routes/pagesAggregator';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Account-ID'],
  exposeHeaders: ['Content-Length', 'X-Request-Id'],
  maxAge: 86400,
}));
app.use('*', errorHandler);

// Aggregate homepage — PUBLIC, unauthenticated. Mounted BEFORE authMiddleware
// so visitors without API_SECRET can load the portfolio/demo landing page.
app.route('/api/aggregate-homepage', aggregateHomepageRouter);

// Health check — also public (Docker healthcheck, monitoring).
// MUST be before authMiddleware.
app.get('/api/health', async (c) => {
  const diag: Record<string, any> = {
    status: 'ok',
    platform: 'cloudflare-workers',
    bindings: {
      DB: !!c.env.DB,
      ENCRYPTION_KEY: !!c.env.ENCRYPTION_KEY,
      API_SECRET: !!c.env.API_SECRET,
      ASSETS: !!c.env.ASSETS,
    },
  };
  if (c.env.DB) {
    try {
      await c.env.DB.prepare('SELECT 1').first();
      diag.db_connected = true;
    } catch (e: any) {
      diag.db_connected = false;
      diag.db_error = e.message;
    }
  }
  return c.json(diag);
});

// OpenAI-compatible routes (MUST be registered BEFORE responseWrapper)
app.use('/v1/*', requestIdMiddleware);
app.use('/v1/*', authMiddleware);
app.route('/v1', openaiRouter);
app.use('/v1/*', v1ErrorHandler);

app.use('/api/v1/*', requestIdMiddleware);
app.use('/api/v1/*', authMiddleware);
app.route('/api/v1', openaiRouter);
app.use('/api/v1/*', v1ErrorHandler);

// Other API routes (with responseWrapper + auth)
app.use('/api/*', responseWrapper);
app.use('/api/*', authMiddleware);

app.onError((err: any, c) => {
  const status = err.statusCode || err.status || 500;
  const message = err.message || 'Internal server error';
  console.error(`[OnError] ${c.req.method} ${c.req.path}: ${message}`);
  return c.json({ error: { code: status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR', message } }, status as any);
});

app.route('/api/accounts', accountsRouter);
app.route('/api/dns', dnsRouter);
app.route('/api/workers', workersRouter);
app.route('/api/browser-render', browserRenderRouter);
app.route('/api/settings', settingsRouter);
app.route('/api/storage', storageRouter);
app.route('/api/store', storeRouter);
app.route('/api/tunnels', tunnelsRouter);
app.route('/api/ai', aiRouter);
app.route('/api/domain-providers', domainProvidersRouter);
app.route('/api/pages-aggregator', pagesAggregatorRouter);

app.get('/api/quota', async (c) => {
  await syncUsageFromCloudflare(c.env.DB, c.env.ENCRYPTION_KEY);
  await invalidateAiCache(c.env);
  const summary = await getQuotaSummary(c.env.DB, c.env.ENCRYPTION_KEY);
  return c.json(summary);
});

app.get('/api/audit-log', async (c) => {
  const action = c.req.query('action');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  if (action || startDate || endDate) {
    const logs = await queryLogs(c.env.DB, { action, startDate, endDate, limit: 500 });
    return c.json(logs);
  }
  const logs = await getRecentLogs(c.env.DB, 100);
  return c.json(logs);
});

app.get('/api/audit-log/actions', async (c) => {
  const actions = await getDistinctActions(c.env.DB);
  return c.json(actions);
});

app.get('/admin', (c) => c.redirect('/admin/', 302));

app.all('/admin/*', async (c) => {
  const url = new URL(c.req.url);
  const strippedPath = url.pathname.replace(/^\/admin/, '') || '/';

  if (/\.\w+$/.test(strippedPath)) {
    const assetUrl = new URL(strippedPath, url.origin).toString();
    const res = await c.env.ASSETS.fetch(new Request(assetUrl));
    if (res.status !== 404) {
      return res;
    }
  }

  const index = await c.env.ASSETS.fetch(new Request(new URL('/index.html', url.origin).toString()));
  return new Response(index.body, {
    status: 200,
    headers: new Headers(index.headers),
  });
});

app.all('*', async (c) => {
  // Root path '/' and '/aggregate-homepage' — when the aggregate homepage
  // is enabled, serve the Vue SPA's index.html so the router can render
  // the portfolio/demo landing page. The SPA is normally served from
  // /admin/, but we serve the same index.html at these root paths when
  // the aggregate homepage is on so visitors land on the portfolio.
  //
  // When the aggregate homepage is disabled, fall back to the fake nginx
  // welcome page (security-through-obscurity: hides the admin UI).
  const url = new URL(c.req.url);
  if (url.pathname === '/' || url.pathname === '/aggregate-homepage' || url.pathname === '') {
    try {
      const raw = await getSetting(c.env.DB, 'aggregate_homepage');
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg.enabled && c.env.ASSETS) {
          const index = await c.env.ASSETS.fetch(new Request(new URL('/index.html', url.origin).toString()));
          return new Response(index.body, {
            status: 200,
            headers: new Headers(index.headers),
          });
        }
      }
    } catch {
      // Config read failed — fall through to fake nginx.
    }
  }
  return c.html(getFakeNginxPage());
});

export { app };

export default {
  fetch: app.fetch,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Periodic catalog refresh every 6 hours
    try {
      const sources = await getEnabledCatalogSources(env.DB);
      for (const source of sources) {
        try {
          const headers: Record<string, string> = {};
          if (source.etag) headers['If-None-Match'] = source.etag;
          const resp = await fetch(source.url, { headers });
          if (resp.status === 304) {
            await updateCatalogSource(env.DB, source.id, {
              last_synced: new Date().toISOString(), last_status: 'ok', last_error: null,
            });
            continue;
          }
          if (!resp.ok) {
            await updateCatalogSource(env.DB, source.id, {
              last_status: 'error', last_error: `HTTP ${resp.status}`,
            });
            continue;
          }
          const json = await resp.json();
          if (env.KV) await env.KV.put(`catalog:${source.id}`, JSON.stringify(json));
          const etag = resp.headers.get('etag');
          await updateCatalogSource(env.DB, source.id, {
            etag: etag || null, last_synced: new Date().toISOString(),
            last_status: 'ok', last_error: null,
          });
        } catch (e: any) {
          await updateCatalogSource(env.DB, source.id, {
            last_status: 'error', last_error: e.message,
          });
        }
      }
    } catch (e) {
      console.error('[Scheduled] Catalog refresh failed:', e);
    }
  },
} satisfies ExportedHandler<Env>;
