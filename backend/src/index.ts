import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { initDb } from './db';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { v1ErrorHandler } from './middleware/v1ErrorHandler';
import { responseWrapper } from './middleware/responseWrapper';
import accountsRouter from './routes/accounts';
import dnsRouter from './routes/dns';
import workersRouter from './routes/workers';
import browserRenderRouter from './routes/browserRender';
import settingsRouter from './routes/settings';
import storageRouter from './routes/storage';
import tasksRouter from './routes/tasks';
import openaiRouter from './routes/openai';
import externalBrowserRenderRouter from './routes/externalBrowserRender';
import aiRouter from './routes/ai';
import storeRouter from './routes/store';
import tunnelsRouter from './routes/tunnels';
import pagesAggregatorRouter from './routes/pagesAggregator';
import domainProvidersRouter from './routes/domainProviders';
import aggregateHomepageRouter from './routes/aggregateHomepage';
import { getQuotaSummary, syncUsageFromCloudflare } from './services/quotaTracker';
import { invalidateAiCache } from './services/accountRouter';
import { getRecentLogs, queryLogs, getDistinctActions } from './models/auditLog';
import { initScheduler } from './services/taskScheduler';
import { initBrowserRateLimiter } from './services/browserRateLimiter';
import { v1RequestLogger } from './middleware/v1Logger';
import { apiRequestLogger } from './middleware/apiLogger';
import { requestIdMiddleware } from './middleware/requestId';
import { appLogger } from './services/logger';
import cron from 'node-cron';
import { getEnabledCatalogSources } from './models/catalogSource';
import { refreshCatalogSource } from './routes/store';

const app = express();

app.use(cors({
  origin: true, // Allow all origins (or specify your frontend URL)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Account-ID'],
  credentials: false,
}));
app.use(express.json({ limit: '100mb' }));

// Health check — before auth so Docker healthcheck works without API_SECRET
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Aggregate homepage — PUBLIC, unauthenticated. Mounted BEFORE authMiddleware
// so visitors without API_SECRET can load the portfolio/demo landing page.
// The admin UI reads/writes the same config via the authenticated
// /api/settings/aggregate-homepage route.
app.use('/api/aggregate-homepage', aggregateHomepageRouter);

app.use(authMiddleware);

// External APIs — no responseWrapper, keep original format
// Mount BEFORE /api middleware to avoid responseWrapper
app.use('/v1', requestIdMiddleware);
app.use('/v1', v1RequestLogger);
app.use('/v1', openaiRouter);
app.use('/v1', v1ErrorHandler); // OpenAI-format error handler (before global errorHandler)
app.use('/v1/browser', externalBrowserRenderRouter);

// Internal APIs — with responseWrapper
app.use('/api', apiRequestLogger);
app.use('/api', responseWrapper);

app.use('/api/accounts', accountsRouter);
app.use('/api/dns', dnsRouter);
app.use('/api/workers', workersRouter);
app.use('/api/browser-render', browserRenderRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/storage', storageRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/ai', aiRouter);
app.use('/api/store', storeRouter);
app.use('/api/tunnels', tunnelsRouter);
app.use('/api/pages-aggregator', pagesAggregatorRouter);
app.use('/api/domain-providers', domainProvidersRouter);
app.use('/api/v1', requestIdMiddleware);
app.use('/api/v1', v1RequestLogger);
app.use('/api/v1', openaiRouter);
app.use('/api/v1', v1ErrorHandler); // OpenAI-format error handler (before global errorHandler)

app.get('/api/quota', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await syncUsageFromCloudflare();
    invalidateAiCache();
    res.json(getQuotaSummary());
  } catch (err) { next(err); }
});

app.get('/api/audit-log', (req, res, next) => {
  try {
    const { action, startDate, endDate } = req.query as any;
    if (action || startDate || endDate) {
      res.json(queryLogs({ action, startDate, endDate, limit: 500 }));
    } else {
      res.json(getRecentLogs(100));
    }
  } catch (err) { next(err); }
});

app.get('/api/audit-log/actions', (_req, res, next) => {
  try {
    res.json(getDistinctActions());
  } catch (err) { next(err); }
});

// ============ Serve Frontend SPA (production) ============
//
// The Vue frontend is built with `cd frontend && npm run build`, which by
// default writes to `../backend/public/` (the single-server production
// layout — only the backend needs to run). As a backwards-compat fallback
// we also check `frontend/dist/` (legacy path used by the original
// Docker compose + worker build). The first directory that contains an
// index.html wins.
//
// Both layouts serve the SPA at the root path so the management UI is
// reachable at http://host:3000/ when running as a single self-hosted
// server (replaces the original Next.js server).
const candidateDirs = [
  path.join(__dirname, '..', 'public'),               // backend/public   (preferred — single-server mode)
  path.join(__dirname, '..', '..', 'frontend', 'dist'), // frontend/dist (fallback — legacy / worker-build)
];
const frontendDist = candidateDirs.find(d => fs.existsSync(path.join(d, 'index.html')));
if (frontendDist) {
  appLogger.info(`[STATIC] Serving frontend from ${frontendDist}`);
  app.use(express.static(frontendDist, {
    index: false,                  // let the catch-all below handle SPA fallback
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      // Never cache index.html so SPA updates ship immediately
      if (path.basename(filePath) === 'index.html') {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));

  // SPA fallback: any non-API GET request returns index.html so vue-router
  // can handle deep links like /workers or /accounts.
  app.get(/^\/(?!api\/|v1\/).*/, (_req: Request, res: Response) => {
    const indexPath = path.join(frontendDist, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('Frontend build not found. Run `npm run build` in the frontend directory.');
    }
  });
} else {
  appLogger.warn(
    `[STATIC] Frontend build not found. Looked in: ${candidateDirs.join(', ')}. ` +
    `Run \`cd frontend && npm run build\` to produce backend/public/ (or set FRONTEND_OUT_DIR). API-only mode.`,
  );
}

app.use(errorHandler);

async function start() {
  initDb();
  initScheduler();
  initBrowserRateLimiter();

  // Catalog refresh cron (every 6 hours)
  cron.schedule('0 */6 * * *', async () => {
    const sources = getEnabledCatalogSources();
    for (const s of sources) {
      try { await refreshCatalogSource(s); } catch (e) { appLogger.error(`[Cron] catalog refresh ${s.id}: ${e}`); }
    }
  });
  app.listen(config.port, () => {
    appLogger.info(`Server running on port ${config.port}`);
  });
}

process.on('uncaughtException', (err) => {
  appLogger.error(`[UNCAUGHT] ${err}`);
});
process.on('unhandledRejection', (err) => {
  appLogger.error(`[UNHANDLED_REJECTION] ${err}`);
});

start().catch((err) => appLogger.error(`[STARTUP] ${err}`));
