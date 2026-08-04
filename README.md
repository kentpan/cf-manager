[English](README.md) | [简体中文](README.zh-CN.md)

# CF Manager

> ## ⚠️ Disclaimer & Compliance Notice
>
> This tool is intended **for learning, technical research, and self-hosted operations management of accounts you are authorized to use**. Any consequences arising from its use—including account bans, IP bans, charges, or other issues—are the sole responsibility of the user. The open-source project and its authors are not liable.
>
> - Strictly comply with the [Cloudflare Terms of Service (including Acceptable Use)](https://www.cloudflare.com/terms/). **Do not** use this project to provide public AI / rendering proxy services to third parties, or for reselling or splitting compute resources in violation of the terms.
> - Only add Cloudflare accounts that belong to you or that you are explicitly authorized to manage. Do not use any unauthorized account.
> - Multi-account switching and automatic quota switching must be used **only with multiple self-owned accounts that you are legally authorized to operate**. Bulk-attaching accounts to automatically split AI quotas may violate the Cloudflare service agreement and is not recommended.
> - Control your request rate. Avoid bulk or automated excessive requests that could trigger risk control or account suspension.
> - Features involving external URLs (e.g. browser rendering) should only be used with trusted sources, to guard against SSRF and internal network probing.
> - If you are unsure whether a feature complies with the Cloudflare Terms of Service, refer to the official terms and seek legal advice first.

## What Is This

> CF Manager is a **one-stop, multi-account unified management platform for Cloudflare**, built for developers and operators. It solves the pain of constantly switching between multiple account dashboards and the tedium of bulk resource operations.

- **What it is**: A self-hosted operations panel built on the official Cloudflare API. It unifies the management entry points of multiple accounts and multiple products (DNS / Workers / Pages / Storage / AI / Rendering) into a single interface.
- **Who it's for**: Individual developers, site owners, and operators who own multiple Cloudflare accounts; users who want to self-host locally and fully control their credentials and data.
- **Problems it solves**: Constant backend switching across accounts, tedious bulk resource operations, and the lack of a unified local debugging entry point for AI inference and browser rendering.
- **Core capabilities**: Visually manage domain DNS, Workers, Pages, and KV/D1/R2 storage; built-in local debugging for AI inference and web rendering; and an **internal / local-network-only** OpenAI-compatible adapter interface.
- **What it is NOT**: It is not a public AI / rendering proxy service. The OpenAI-compatible interface is for your own local debugging only and must never be used for reselling or any scenario that violates the Cloudflare Terms of Service.

## Online Demo

| | |
|---|---|
| URL | [https://mgrcf.pages.dev/admin/](https://mgrcf.pages.dev/admin/) |
| Password | `cfmgrbest` |

> The demo is deployed on Cloudflare Pages + D1, no Docker required. The root path shows a disguised nginx welcome page; the management UI is accessible via `/admin/`.
>
> ⚠️ The demo is bound to a **dedicated demo account**. All features are usable but with limited quota, for UI and feature demonstration only. **Do not use it for real business or bulk calls.** This is a publicly shared demo account; abuse may cause it to be rate-limited or banned by Cloudflare.

## Features

| Module | Core Capabilities |
|---|---|
| **Multi-account Management** | API Token / Global API Key dual auth · AES-encrypted credentials · unified account switching ([auth docs](docs/account-auth.md)) |
| **Dashboard** | Real-time quota usage per account (Workers, AI, Rendering) · visual progress bars · operation audit |
| **Workers / Pages** | Script/Project CRUD · single/cross-account batch deployment · bindings/env vars/routes/custom domains · Pages rollback |
| **DNS Management** | A/AAAA/CNAME/MX/TXT record management · one-click proxy toggle · bulk operations |
| **Tunnel Management** | Tunnel create/delete · visual Ingress editor (domain↔service mapping) · one-click origin wizard (DNS CNAME + auto Ingress config) |
| **Rules Engine** | 8 rule types (origin, URL rewrite, request/response header transform, cache, firewall, rate limit, redirect) · structured form + advanced mode · expression builder |
| **Storage Management** | KV key-value CRUD · D1 SQL query + schema changes · R2 file upload/download/preview |
| **AI Inference** | Full Workers AI models · Prompt Caching-aware billing · streaming chat + reasoning visualization · conversation history · multi-account scheduling |
| **Browser Rendering** | 5 modes: screenshot / HTML / Markdown / PDF / link extraction · rate limit + quota management · SSRF protection |
| **OpenAI-compatible API** | `/v1/chat/completions`, `/v1/models`, browser rendering endpoints · streaming + non-streaming · local/internal only ([API docs](docs/api-v1.md)) |
| **App Store** | Built-in Catalog template marketplace · third-party source extension · one-click Workers/Pages deployment |
| **System Settings** | HTTP/SOCKS5 proxy · cache purge · scheduled task extensions |
| **Security** | AES-encrypted API Token · optional login password · `/admin/` path hiding + nginx disguise · audit log |

---

## Quick Start

> Four deployment options are available. See the [deployment docs](docs/deploy.md) for details.

<details open>
<summary><strong>Option 1: Fork One-Click Deploy (easiest)</strong></summary>

No tools to install—everything happens in the browser.

**Recommended: Use the Secrets version (secrets never leak into logs)**

1. **Fork this repo** → click Fork in the top-right corner
2. Go to your fork → **Settings** → **Environments** → **New environment**, create an environment (e.g. `production`), and add 4 secrets inside it:
   - `CF_API_KEY`: Cloudflare Global API Key (high-privilege key; prefer a scoped API Token, see [account auth docs](docs/account-auth.md))
   - `CF_EMAIL`: Cloudflare account email
   - `ENCRYPTION_KEY`: encryption key (use a strong random string, at least 16 chars)
   - `API_SECRET`: management UI access password (use a strong random string, avoid weak passwords)
3. Go to **Actions** → select **Deploy to Cloudflare Pages (Secrets)** → **Run workflow**, enter the environment name such as `production`
4. Wait for deployment to finish, then visit `https://cfmgr.pages.dev/admin/`

> ⚠️ Important: Bind only your own separate business/test accounts. Do not bulk-attach accounts to automatically split AI quotas—this violates the Cloudflare service agreement.

> For multiple accounts, create multiple Environments with separate secrets, then enter the corresponding environment name at deploy time.

> Get Cloudflare Global API Key: [Cloudflare Dashboard](https://dash.cloudflare.com/profile/api-tokens) → API Keys → Global API Key → View

</details>

<details>
<summary><strong>Option 2: Manual Cloudflare Pages Deploy (zero cost)</strong></summary>

Download the prebuilt bundle and upload it to the Cloudflare Dashboard.

**1. Download the deployment bundle:**

👉 [Download the latest cf-manager.zip](https://github.com/hefy2027/cf-manager/releases/latest/download/cf-manager.zip)

Or build locally: `cd worker && npm install && npm run build`

**2. Create a D1 database:**

Cloudflare Dashboard → Workers & Pages → D1 → Create → name it `cf-manager` → run `worker/src/db/schema.sql` in the Console

**3. Upload & deploy:**

Workers & Pages → Create → Pages → Upload assets → upload `cf-manager.zip`

**4. Configure Bindings:**

Settings → Bindings → Add D1 Database → Variable name: `DB` → select your database

Settings → Bindings → Add KV Namespace → Variable name: `KV` → create or select an existing namespace

Settings → Environment variables → add `ENCRYPTION_KEY` and `API_SECRET` (optional)

**5. Redeploy, then visit** `https://your-project.pages.dev/admin/`

</details>

<details>
<summary><strong>Option 3: Docker Deploy (self-hosted server)</strong></summary>

```bash
# 1. Clone the project
git clone https://github.com/hefy2027/cf-manager.git
cd cf-manager

# 2. Create the config file
cp .env.example .env

# 3. Edit .env — at minimum set ENCRYPTION_KEY
#    Optionally set API_SECRET (UI login password), PROXY_URL (proxy address)
#    Optionally set BASE_URL (frontend path, e.g. /admin/)

# 4. One-click deploy
chmod +x deploy.sh
./deploy.sh

# 5. Visit http://localhost:3000 (or http://localhost:3000/admin/ if BASE_URL is set)
```

</details>

<details>
<summary><strong>Option 4: Cloudflare Pages auto-deploy from GitHub (recommended for continuous deployment)</strong></summary>

This is the recommended path for forks that want every `git push` to automatically rebuild and redeploy Cloudflare Pages. No manual uploads, no prebuilt bundle downloads — GitHub Actions handles everything.

**How it works**

The workflow at `.github/workflows/pages-gh-deploy.yml` triggers on every push to `main` (or `master`). It:

1. Checks out your repo on the GitHub Actions runner.
2. Resolves your Cloudflare Account ID via `wrangler whoami`.
3. Creates the D1 database + KV namespace **if they don't already exist** (idempotent — re-running on an existing project won't delete data).
4. Runs `worker/src/db/schema.sql` (CREATE TABLE IF NOT EXISTS) and `worker/src/db/migrations.sql` (ALTER TABLE / INSERT OR IGNORE) on the D1 database so the schema always matches the code.
5. Builds the frontend (`npm run build` inside `frontend/`) with `VITE_BASE_URL=/admin/` so the SPA loads from the `/admin/` path.
6. Bundles the worker (`esbuild src/index.ts → public/_worker.js`) and copies the frontend dist into `worker/public/` so the final bundle is self-contained.
7. Creates the Pages project if it doesn't exist (`wrangler pages project create`), then deploys (`wrangler pages deploy`).
8. Resolves the `*.pages.dev` subdomain from the Cloudflare API and prints it as a notice + in the workflow summary.

**Setup steps**

1. **Fork this repo** to your own GitHub account.

2. In the Cloudflare dashboard, create an API token with these permissions (the scoped token is preferred over the Global API Key):
   - **Account → Cloudflare Pages → Edit**
   - **Account → D1 → Edit**
   - **Account → Workers KV Storage → Edit**
   - **User → User Details → Read** (needed for `wrangler whoami` to resolve your Account ID)
   - Save the token — you'll paste it into GitHub in step 4.

3. Generate a strong random string (at least 16 chars) for `ENCRYPTION_KEY` — this is what encrypts the API tokens stored in D1. Keep it stable across redeploys; if you change it later, you'll need to re-enter credentials.

4. In your fork → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, add:
   - `CLOUDFLARE_API_TOKEN` — the token from step 2 (recommended).
   - If you prefer the legacy path: `CLOUDFLARE_API_KEY` + `CLOUDFLARE_EMAIL` (Global API Key + account email) instead of the token.
   - `ENCRYPTION_KEY` — the random string from step 3 (required).
   - `API_SECRET` — management UI login password (optional; empty = no login required).

5. (Optional) If you want per-environment secrets (e.g. separate staging/prod), go to **Settings → Environments → New environment**, name it `production`, and add the same secrets there. The workflow will use Environment secrets when triggered manually with `environment: production`.

6. Push to `main` (or run the workflow manually from **Actions → Deploy to Cloudflare Pages (Auto on Push) → Run workflow**). The first run takes ~3–5 minutes and will:

   - Create the D1 database named `cfmgr` (override with `D1_DATABASE_NAME` repository variable).
   - Create the KV namespace named `cfmgr` (override with `KV_NAMESPACE_NAME`).
   - Create the Pages project named `cfmgr` (override with `PROJECT_NAME`).
   - Deploy and print the URL `https://<project-subdomain>.pages.dev/admin/`.

7. Open the URL. The first load shows a login screen if `API_SECRET` is set; otherwise it goes straight to the dashboard.

**Customising the resource names**

Add repository variables (Settings → Secrets and variables → Actions → **Variables** tab — *not* secrets) to override the defaults:

| Variable | Default | Purpose |
|---|---|---|
| `PROJECT_NAME` | `cfmgr` | Cloudflare Pages project name |
| `D1_DATABASE_NAME` | `cfmgr` | D1 database name |
| `KV_NAMESPACE_NAME` | `cfmgr` | KV namespace title |

Or trigger the workflow manually (**Actions → Run workflow**) and pass the names as inputs.

**Subsequent pushes**

Every `git push` to `main` re-runs the workflow. The D1/KV/Pages resources are reused (the workflow checks for existence before creating). Schema migrations in `worker/src/db/migrations.sql` are re-applied (idempotent via `INSERT OR IGNORE` and `|| true` on `ALTER TABLE`), so new tables/columns/seed rows are added automatically.

**Concurrency control**

The workflow uses `concurrency: pages-deploy-${{ github.ref }}` with `cancel-in-progress: true`, so a new push cancels any in-flight deploy for the same branch — no stale builds pile up.

**Rolling back**

Cloudflare Pages keeps every deployment. Open the Pages project in the dashboard → **Deployments** → find the previous version → **Activate alias** to roll back instantly without re-running the workflow.

</details>

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ENCRYPTION_KEY` | Yes | Key used to encrypt stored API Tokens (any random string, at least 16 chars) |
| `API_SECRET` | No | Management UI access password; empty means no login required |
| `PROXY_URL` | No | HTTP/SOCKS5 proxy address, e.g. `http://127.0.0.1:7890` or `socks5://127.0.0.1:1080` |
| `APP_PORT` | No | Exposed port, default `3000` |
| `BASE_URL` | No | Frontend base path, e.g. `/admin/`, default `/` (Docker only; Worker is fixed to `/admin/`) |
| `DEMO_ACCOUNT_IDS` | No | Protected demo account IDs (comma-separated), e.g. `1,2,3`. Protected accounts cannot be deleted or modified |
| `KV` (Binding) | No | KV Namespace binding (Pages deploy only), used for concurrent-request protection and cache-aware routing. Optional but recommended |

<details>
<summary><strong>Local Development</strong></summary>

```bash
# Backend (http://localhost:3001)
cd backend
npm install
ENCRYPTION_KEY="dev-key" npm run dev

# Frontend (http://localhost:5173, auto-proxies /api to backend)
cd frontend
npm install
npm run dev
```

</details>

---

## Tech Stack

| Layer | Docker | Worker |
|---|---|---|
| Frontend | Vue 3 + Naive UI + Pinia | Same |
| Backend | Express 5 + Cloudflare SDK | Hono + Cloudflare REST API |
| Database | SQLite (better-sqlite3) | Cloudflare D1 |
| Deploy | Docker Compose | Cloudflare Pages |

---

## Project Structure

```
cf-manager/
├── backend/                 # Backend API service
│   └── src/
│       ├── index.ts         # Express entry
│       ├── config.ts        # Config
│       ├── db.ts            # SQLite database
│       ├── middleware/      # Auth, error handling, response wrapper
│       ├── models/          # Data models
│       ├── routes/          # API routes
│       └── services/        # Business logic (Cloudflare SDK wrapper)
├── frontend/                # Vue frontend app
│   └── src/
│       ├── api/             # API call wrappers
│       ├── views/           # Page components
│       ├── components/      # Reusable components (StoreDeployDialog, etc.)
│       ├── stores/          # Pinia state management
│       └── utils/           # Utility functions
├── worker/                  # Cloudflare Pages deployment
│   ├── src/                 # Hono API routes + D1 models
│   ├── build.js             # One-click build script
│   └── wrangler.toml        # Wrangler config
├── docker/                  # Docker build config
│   ├── backend/Dockerfile
│   └── frontend/
│       ├── Dockerfile
│       ├── nginx.conf.template  # Nginx config template (supports BASE_URL)
│       └── entrypoint.sh        # Container entrypoint script
├── shared/                  # Shared frontend/backend config
│   ├── model-pricing.json    # AI model pricing (incl. cache pricing)
│   ├── catalog.schema.json   # Catalog template JSON Schema
│   └── catalogValidator.ts   # Catalog validator source
├── docs/                    # Documentation
│   ├── api-v1.md            # External API docs
│   ├── account-auth.md      # Account auth docs
│   └── deploy.md            # Deployment docs
├── docker-compose.yml
├── deploy.sh                # One-click deploy script
├── CHANGELOG.md             # Changelog
└── .env.example             # Env var template
```

---

## Screenshots

<table>
  <tr>
    <td width="33%"><img src="images/dashboard.png" alt="Dashboard"><br><em>Dashboard</em></td>
    <td width="33%"><img src="images/accounts.png" alt="Accounts"><br><em>Accounts</em></td>
    <td width="33%"><img src="images/workers.png" alt="Workers / Pages"><br><em>Workers / Pages</em></td>
  </tr>
  <tr>
    <td><img src="images/dns.png" alt="DNS"><br><em>DNS</em></td>
    <td><img src="images/storage.png" alt="Storage"><br><em>Storage (KV / D1 / R2)</em></td>
    <td><img src="images/ai.png" alt="AI Inference"><br><em>AI Inference</em></td>
  </tr>
  <tr>
    <td><img src="images/browser-render.png" alt="Browser Rendering"><br><em>Browser Rendering</em></td>
    <td><img src="images/settings.png" alt="Settings"><br><em>Settings</em></td>
    <td><img src="images/store.png" alt="App Store"><br><em>App Store</em></td>
  </tr>
  <tr>
    <td><img src="images/tunnels.png" alt="Tunnels"><br><em>Tunnels</em></td>
    <td><img src="images/rules-engine.png" alt="Rules Engine"><br><em>Rules Engine</em></td>
    <td></td>
  </tr>
</table>

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=hefy2027/cf-manager&type=Date)](https://star-history.com/#hefy2027/cf-manager&Date)

## License

[MIT](LICENSE) © 2024 CF Manager Contributors


## Related Projects

- [cf-store](https://github.com/hefy2027/cf-store): The Catalog template repository for CF Manager's "App Store" (app/Worker deployment template source). Refer to it if you want to contribute or self-host templates.

## 社区与公众号

本开源项目已链接并认可 [LINUX DO 社区](https://linux.do)。

欢迎关注公众号「**AI非与**」，获取项目更新与技术分享：

<img src="https://i.ibb.co/mFq91Rzq/ai-feyu-wechat-qr.jpg" alt="AI非与公众号" width="200" />
