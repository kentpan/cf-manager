import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from './config';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(config.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function initDb(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      auth_type   TEXT NOT NULL CHECK(auth_type IN ('token', 'global_key')),
      api_token   TEXT,
      api_key     TEXT,
      email       TEXT,
      account_id  TEXT,
      is_active   INTEGER DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS quota_usage (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id  INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
      resource    TEXT NOT NULL,
      date        DATE NOT NULL,
      count       INTEGER DEFAULT 0,
      optimistic  INTEGER DEFAULT 0,
      exhausted   INTEGER DEFAULT 0,
      UNIQUE(account_id, resource, date)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      action      TEXT NOT NULL,
      target      TEXT,
      detail      TEXT,
      status      TEXT NOT NULL CHECK(status IN ('success', 'error')),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL,
      cron        TEXT NOT NULL,
      config      TEXT,
      enabled     INTEGER DEFAULT 1,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS task_executions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id     INTEGER NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
      status      TEXT NOT NULL CHECK(status IN ('running', 'success', 'error')),
      detail      TEXT,
      started_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS catalog_sources (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      url           TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      is_default    INTEGER DEFAULT 0,
      enabled       INTEGER DEFAULT 1,
      last_synced   DATETIME,
      last_status   TEXT DEFAULT 'pending',
      last_error    TEXT,
      etag          TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Free-domain provider registry (DNSHE, Namecheap, GoDaddy, Dynadot,
    -- Aliyun, Tencent, Namesilo, Porkbun, Cloudflare Registrar, ...).
    --
    -- Each row describes *how* to talk to a registrar's API:
    --   - code          stable identifier for service dispatch (e.g. 'dnshe')
    --   - api_base_url  root URL of the registrar's REST API
    --   - auth_type     how credentials are sent:
    --                       'header'    = X-API-Key + X-API-Secret (DNSHE)
    --                       'bearer'    = Authorization: Bearer <token> (Porkbun, Namesilo)
    --                       'query'     = ?ApiKey=...&ApiUser=... (Namecheap)
    --                       'basic'     = HTTP Basic (Dynadot)
    --   - capabilities  comma-separated list of supported operations
    --                       'domains.list', 'domains.register', 'domains.renew',
    --                       'domains.delete', 'dns.list', 'dns.create',
    --                       'dns.update', 'dns.delete', 'quota'
    --   - doc_url       link to the provider's official API docs
    --   - regions       comma-separated list of regions the provider serves
    --                    (e.g. 'CN' for domestic-only, 'GLOBAL' for international)
    --   - promo_url     affiliate/referral link shown on the register dialog
    --
    -- Account-level credentials live in domain_provider_accounts so a single
    -- provider can have many API keys attached (multi-account, just like CF
    -- accounts).
    CREATE TABLE IF NOT EXISTS domain_providers (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      code                TEXT NOT NULL UNIQUE,             -- e.g. 'dnshe' — stable identifier for service dispatch
      name                TEXT NOT NULL,                    -- display name e.g. 'DNSHE'
      api_base_url        TEXT NOT NULL,                    -- e.g. 'https://api005.dnshe.com/index.php'
      auth_type           TEXT NOT NULL DEFAULT 'header',   -- 'header' | 'bearer' | 'query' | 'basic'
      capabilities        TEXT DEFAULT '',                  -- comma-separated list of supported ops
      doc_url             TEXT DEFAULT '',                  -- link to official API docs (used by the "API 文档" button)
      register_url        TEXT DEFAULT '',                  -- sign-up / console URL (used by the "前往注册" button)
      promo_url           TEXT DEFAULT '',                 -- affiliate/referral link (preferred over register_url when set)
      regions             TEXT DEFAULT 'GLOBAL',            -- 'CN' | 'GLOBAL' | 'CN,GLOBAL'
      description         TEXT DEFAULT '',                  -- one-line summary shown above the registration steps
      commission_model    TEXT DEFAULT '',                  -- e.g. '免费子域名, 1 年有效期, 续期消耗 9.90 信用' — analogue of supply.vue's commissionModel
      registration_steps  TEXT DEFAULT '',                  -- JSON array of {title, detail} — rendered as a numbered list in the Add Account modal
      credential_fields   TEXT DEFAULT '',                  -- JSON array of {key,label,type,required,placeholder,help} — drives the dynamic form below the steps
      is_default          INTEGER DEFAULT 0,                -- 1 = pre-seeded provider; UI shows it pinned
      enabled             INTEGER DEFAULT 1,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Per-provider API credentials. Encrypted with the same ENCRYPTION_KEY
    -- as CF accounts so existing reset-credentials tooling also covers this.
    -- api_key/api_secret naming is preserved for backward compat with the
    -- DNSHE integration; for providers that only need a single token (Porkbun,
    -- Namesilo), api_key holds the token and api_secret stays empty.
    CREATE TABLE IF NOT EXISTS domain_provider_accounts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id   INTEGER NOT NULL REFERENCES domain_providers(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,                    -- user-defined label
      api_key       TEXT,                             -- encrypted — primary credential (token / api key)
      api_secret    TEXT,                             -- encrypted — secondary credential (api secret / api user)
      api_user      TEXT,                             -- encrypted — third field for providers like Namecheap (ApiUser)
      is_active     INTEGER DEFAULT 1,
      last_synced   DATETIME,
      last_error    TEXT,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_domain_provider_accounts_provider ON domain_provider_accounts(provider_id);
  `);

  // ---- Migrate domain_providers: add new columns to existing tables ----
  // These columns were added progressively (v1.0.2 + v1.0.4) to support
  // generic multi-registrar capabilities + per-provider registration flow
  // docs (mirroring supply.vue's "申请注册流程" pattern). ALTER TABLE
  // ADD COLUMN keeps existing rows + data intact and backfills the DEFAULT
  // for newly-added columns. The seed insert/update below then upserts the
  // canonical provider list including the new fields.
  const providerCols = db.prepare("PRAGMA table_info('domain_providers')").all() as { name: string }[];
  if (providerCols.length > 0) {
    // Table exists from a previous install — add missing columns.
    if (!providerCols.find(c => c.name === 'auth_type')) {
      db.exec("ALTER TABLE domain_providers ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'header'");
    }
    if (!providerCols.find(c => c.name === 'capabilities')) {
      db.exec("ALTER TABLE domain_providers ADD COLUMN capabilities TEXT DEFAULT ''");
    }
    if (!providerCols.find(c => c.name === 'doc_url')) {
      db.exec("ALTER TABLE domain_providers ADD COLUMN doc_url TEXT DEFAULT ''");
    }
    if (!providerCols.find(c => c.name === 'regions')) {
      db.exec("ALTER TABLE domain_providers ADD COLUMN regions TEXT DEFAULT 'GLOBAL'");
    }
    // v1.0.4 — full registration flow metadata (mirror supply.vue's modal)
    if (!providerCols.find(c => c.name === 'register_url')) {
      db.exec("ALTER TABLE domain_providers ADD COLUMN register_url TEXT DEFAULT ''");
    }
    if (!providerCols.find(c => c.name === 'description')) {
      db.exec("ALTER TABLE domain_providers ADD COLUMN description TEXT DEFAULT ''");
    }
    if (!providerCols.find(c => c.name === 'commission_model')) {
      db.exec("ALTER TABLE domain_providers ADD COLUMN commission_model TEXT DEFAULT ''");
    }
    if (!providerCols.find(c => c.name === 'registration_steps')) {
      db.exec("ALTER TABLE domain_providers ADD COLUMN registration_steps TEXT DEFAULT ''");
    }
    if (!providerCols.find(c => c.name === 'credential_fields')) {
      db.exec("ALTER TABLE domain_providers ADD COLUMN credential_fields TEXT DEFAULT ''");
    }
  }

  const dpAccCols = db.prepare("PRAGMA table_info('domain_provider_accounts')").all() as { name: string }[];
  if (dpAccCols.length > 0) {
    if (!dpAccCols.find(c => c.name === 'api_user')) {
      db.exec("ALTER TABLE domain_provider_accounts ADD COLUMN api_user TEXT");
    }
  }

  // ---- Pre-seed mainstream domain registrars ----
  // Idempotent: only inserts rows whose code does not yet exist. Editing /
  // disabling a seeded provider later is preserved across restarts because
  // the seed only runs when the row is missing.
  //
  // Each seed row carries the FULL registration flow metadata so the Add
  // Account modal can render the supply.vue-style "申请注册流程" panel
  // (numbered steps + API 文档 / 前往注册 buttons + dynamic credential
  // form) without any hardcoded UI knowledge of which provider is selected.
  interface RegStep { title: string; detail: string; }
  interface CredField { key: string; label: string; type: 'text' | 'password'; required: boolean; placeholder: string; help?: string; }
  interface SeedProvider {
    code: string; name: string; api_base_url: string;
    auth_type: string; capabilities: string; doc_url: string;
    register_url: string; promo_url: string; regions: string;
    description: string; commission_model: string;
    registration_steps: RegStep[];
    credential_fields: CredField[];
    is_default: number;
  }
  const DEFAULT_PROVIDERS: SeedProvider[] = [
    {
      // DNSHE — free-subdomain provider, fully integrated. Default selection.
      code: 'dnshe',
      name: 'DNSHE',
      api_base_url: 'https://api005.dnshe.com/index.php',
      auth_type: 'header',
      capabilities: 'domains.list,domains.register,domains.delete,domains.renew,dns.list,dns.create,dns.update,dns.delete,quota',
      doc_url: 'https://my.dnshe.com/knowledgebase/13/DNSHE%E5%85%8D%E8%B4%B9%E5%9F%9F%E5%90%8DAPI%E4%BD%BF%E7%94%A8%E6%96%87%E6%A1%A3V2.0.html',
      register_url: 'https://my.dnshe.com/register.php',
      promo_url: 'https://my.dnshe.com/go.php?code=KRDQzaIlJb',
      regions: 'GLOBAL',
      description: '免费子域名注册平台, 支持 200+ 根域名后缀, 自带 DNS 解析与 Cloudflare 接入',
      commission_model: '免费子域名, 默认 1 年有效期, 续期消耗 9.90 信用点',
      registration_steps: [
        { title: '注册 DNSHE 账号', detail: '访问 my.dnshe.com, 用邮箱注册并完成邮箱验证 (个人/企业均可)' },
        { title: '前往「免费域名管理」', detail: '登录客户区 → 左侧导航「免费域名管理」→ 进入域名管理面板' },
        { title: '创建 API Key', detail: '在「API 管理」→「创建 API Key」, 填写 Key 名称后保存。⚠️ api_secret 仅显示一次, 请立即复制保存' },
        { title: '查看可用根域名', detail: '在域名列表页可看到所有可注册的根域名 (如 dnshe.com, 等), 选一个心仪的根域名' },
        { title: '配置到本系统', detail: '将 API Key + API Secret 填入下方表单, 即可在本系统内注册/管理子域名 + 配置 DNS 解析' },
      ],
      credential_fields: [
        { key: 'api_key', label: 'API Key', type: 'text', required: true, placeholder: 'cfsd_xxxxxxxxxx', help: '在 DNSHE 客户区「API 管理」页面创建, 以 cfsd_ 开头' },
        { key: 'api_secret', label: 'API Secret', type: 'password', required: true, placeholder: '创建 API Key 时仅显示一次, 请妥善保存', help: '⚠️ 创建时只显示一次, 丢失需重新生成' },
      ],
      is_default: 1,
    },
    {
      // Porkbun — low-cost registrar, clean REST API.
      code: 'porkbun',
      name: 'Porkbun',
      api_base_url: 'https://api.porkbun.com/api/json/v3',
      auth_type: 'bearer',
      capabilities: 'domains.list,dns.list,dns.create,dns.update,dns.delete',
      doc_url: 'https://porkbun.com/api/apiDoc',
      register_url: 'https://porkbun.com/account/register',
      promo_url: 'https://porkbun.com/',
      regions: 'GLOBAL',
      description: '海外低成本域名注册商, 价格透明无续费涨价, 免费 WHOIS 隐私 + SSL',
      commission_model: '按年付费注册, 价格透明 (如 .com $10.48/年, 续费同价)',
      registration_steps: [
        { title: '注册 Porkbun 账号', detail: '访问 porkbun.com/account/register, 用邮箱注册并验证' },
        { title: '添加域名到购物车', detail: '搜索心仪域名, 加入购物车并完成付款 (支持支付宝/PayPal/信用卡)' },
        { title: '进入 API Access 页面', detail: '登录后 → Account → API Access → 点击「Create API Key」' },
        { title: '保存 API Key + Secret', detail: '系统会同时显示 apikey + secretapi, ⚠️ secretapi 仅显示一次, 请立即复制保存' },
        { title: '配置到本系统', detail: '将 apikey + secretapi 填入下方表单, 即可在本系统内管理 Porkbun 域名 + DNS 记录' },
      ],
      credential_fields: [
        { key: 'api_key', label: 'API Key', type: 'text', required: true, placeholder: 'pk1_xxxxxxxxxx', help: '在 Porkbun Account → API Access 页面创建, 以 pk1_ 开头' },
        { key: 'api_secret', label: 'Secret API Key', type: 'password', required: true, placeholder: 'sk1_xxxxxxxxxx', help: '⚠️ 创建时仅显示一次, 丢失需重新生成' },
      ],
      is_default: 0,
    },
    {
      // Namesilo — accredited registrar, free WHOIS privacy.
      code: 'namesilo',
      name: 'Namesilo',
      api_base_url: 'https://www.namesilo.com/api/',
      auth_type: 'query',
      capabilities: 'domains.list,domains.register,domains.renew,dns.list,dns.create,dns.update,dns.delete',
      doc_url: 'https://www.namesilo.com/api-reference',
      register_url: 'https://www.namesilo.com/create-account',
      promo_url: 'https://www.namesilo.com/',
      regions: 'GLOBAL',
      description: 'ICANN 认证域名注册商, 免费 WHOIS 隐私保护, 价格含税透明',
      commission_model: '按年付费注册, 价格透明 (如 .com $10.95/年)',
      registration_steps: [
        { title: '注册 Namesilo 账号', detail: '访问 namesilo.com/create-account, 用邮箱注册并验证' },
        { title: '充值或绑定支付方式', detail: '在 Account → Billing 添加 PayPal/信用卡, 确保账户有余额或有效支付方式' },
        { title: '生成 API Key', detail: 'Account → API Manager → 点击「Generate API Key」, 复制生成的 key' },
        { title: 'IP 白名单 (可选但推荐)', detail: '在 API Manager 页面可设置允许调用 API 的 IP 白名单, 提升安全性' },
        { title: '配置到本系统', detail: '将 API Key 填入下方表单 (Namesilo 只需一个 key), 即可在本系统内管理域名 + DNS' },
      ],
      credential_fields: [
        { key: 'api_key', label: 'API Key', type: 'password', required: true, placeholder: '在 API Manager 生成的 key (16 位字符)', help: '只需一个 API Key, 在 Account → API Manager 生成' },
      ],
      is_default: 0,
    },
    {
      // Namecheap — major international registrar, requires ApiUser + ApiKey + IP whitelist.
      code: 'namecheap',
      name: 'Namecheap',
      api_base_url: 'https://api.namecheap.com/xml.response',
      auth_type: 'query',
      capabilities: 'domains.list,domains.register,domains.renew,dns.list,dns.create,dns.update,dns.delete',
      doc_url: 'https://www.namecheap.com/support/api/methods/',
      register_url: 'https://www.namecheap.com/myaccount/signup/',
      promo_url: 'https://www.namecheap.com/',
      regions: 'GLOBAL',
      description: '海外主流域名注册商, 价格亲民, 首年优惠多, 续费略涨',
      commission_model: '按年付费, 首年优惠 (如 .com 首年 $7.98, 续费 $10.98)',
      registration_steps: [
        { title: '注册 Namecheap 账号', detail: '访问 namecheap.com, 用邮箱注册并验证 (需手机号验证)' },
        { title: '启用 API 访问', detail: '登录后 → Profile → Tools → API Access → 勾选「Enable API」' },
        { title: '配置 IP 白名单', detail: '⚠️ Namecheap 强制要求 IP 白名单, 在 API Access 页面填入本服务器公网 IP' },
        { title: '记录 ApiUser + ApiKey', detail: 'ApiUser = 登录用户名, ApiKey = 在 API Access 页面生成的密钥, ⚠️ 务必复制保存' },
        { title: '配置到本系统', detail: '将 ApiUser + ApiKey 填入下方表单 (两者均必填), 即可在本系统内管理 Namecheap 域名' },
      ],
      credential_fields: [
        { key: 'api_user', label: 'ApiUser', type: 'text', required: true, placeholder: 'Namecheap 登录用户名', help: '与登录账号相同的用户名' },
        { key: 'api_key', label: 'API Key', type: 'password', required: true, placeholder: '在 API Access 页面生成的密钥', help: '⚠️ 务必先配置 IP 白名单, 否则 API 调用会返回 105 错误' },
      ],
      is_default: 0,
    },
    {
      // GoDaddy — largest ICANN-accredited registrar. sso-key auth.
      code: 'godaddy',
      name: 'GoDaddy',
      api_base_url: 'https://api.godaddy.com/v1',
      auth_type: 'bearer',
      capabilities: 'domains.list,domains.renew,dns.list,dns.create,dns.update,dns.delete',
      doc_url: 'https://developer.godaddy.com/doc',
      register_url: 'https://sso.godaddy.com/account/create',
      promo_url: 'https://www.godaddy.com/',
      regions: 'GLOBAL',
      description: '全球最大 ICANN 认证域名注册商, 品牌知名度高, 首年优惠力度大',
      commission_model: '按年付费, 首年大额优惠 (如 .com 首年 $1.99, 续费 $20+)',
      registration_steps: [
        { title: '注册 GoDaddy 账号', detail: '访问 godaddy.com, 用邮箱注册并完成验证' },
        { title: '进入 Developer Portal', detail: '访问 developer.godaddy.com, 登录后 → Keys → 点击「Create New Key」' },
        { title: '选择环境 + 创建 Key', detail: '选择 Production 环境 (不是 OTE 测试环境), 填写 Key Name 后生成' },
        { title: '保存 Key + Secret', detail: '⚠️ GoDaddy 会同时显示 Key + Secret, Secret 仅显示一次, 请立即复制保存' },
        { title: '配置到本系统', detail: '将 Key 填入 API Key, Secret 填入 API Secret (GoDaddy 用 sso-key Key:Secret 格式认证)' },
      ],
      credential_fields: [
        { key: 'api_key', label: 'Key', type: 'text', required: true, placeholder: 'Production 环境的 Key', help: '在 developer.godaddy.com → Keys 创建, ⚠️ 选 Production 不是 OTE' },
        { key: 'api_secret', label: 'Secret', type: 'password', required: true, placeholder: '与 Key 配套的 Secret', help: '⚠️ 仅显示一次, 丢失需重新生成 Key' },
      ],
      is_default: 0,
    },
    {
      // Dynadot — popular with domainers, key in query param.
      code: 'dynadot',
      name: 'Dynadot',
      api_base_url: 'https://api.dynadot.com/api3.json',
      auth_type: 'query',
      capabilities: 'domains.list,domains.register,domains.renew,dns.list,dns.create,dns.update,dns.delete',
      doc_url: 'https://www.dynadot.com/domain/api3-doc.html',
      register_url: 'https://www.dynadot.com/account/create',
      promo_url: 'https://www.dynadot.com/',
      regions: 'GLOBAL',
      description: '域名投资者青睐的注册商, 支持批量操作 + 域名交易市场',
      commission_model: '按年付费, 价格中等 (如 .com $11.99/年), 转入优惠多',
      registration_steps: [
        { title: '注册 Dynadot 账号', detail: '访问 dynadot.com/account/create, 用邮箱注册并验证' },
        { title: '充值账户余额', detail: '在 Account → Add Funds 添加余额 (支持 PayPal/信用卡/银行转账)' },
        { title: '生成 API Key', detail: 'Account → API Settings → 点击「Generate API Key」, 复制生成的 key (32 位字符)' },
        { title: '查看 API 文档', detail: '访问 dynadot.com/domain/api3-doc.html 了解各 API 命令 (list, register, set_dns 等)' },
        { title: '配置到本系统', detail: '将 API Key 填入下方表单 (Dynadot 只需一个 key), 即可在本系统内管理域名 + DNS' },
      ],
      credential_fields: [
        { key: 'api_key', label: 'API Key', type: 'password', required: true, placeholder: '在 API Settings 生成的 key (32 位字符)', help: '只需一个 API Key, 在 Account → API Settings 生成' },
      ],
      is_default: 0,
    },
    {
      // Aliyun (阿里云) — China's largest registrar. AccessKeyId + Secret, HMAC-SHA1 signing.
      code: 'aliyun',
      name: '阿里云',
      api_base_url: 'https://domain.aliyuncs.com',
      auth_type: 'bearer',
      capabilities: 'domains.list,domains.register,domains.renew,dns.list,dns.create,dns.update,dns.delete,quota',
      doc_url: 'https://help.aliyun.com/document_detail/89847.html',
      register_url: 'https://account.aliyun.com/register/register.htm',
      promo_url: 'https://www.aliyun.com/',
      regions: 'CN',
      description: '国内最大域名注册商, 备案便利, 解析稳定, 支持 .cn/.com 等所有主流后缀',
      commission_model: '按年付费, 首年优惠 (如 .com 首年 ¥35, 续费 ¥69), 需实名认证',
      registration_steps: [
        { title: '注册阿里云账号', detail: '访问 aliyun.com, 用手机号注册并完成实名认证 (个人/企业均可)' },
        { title: '申请 AccessKey', detail: '登录控制台 → 右上角头像 → AccessKey 管理 → 创建 AccessKey (建议使用子账号 + RAM 权限策略)' },
        { title: '保存 AccessKeyId + Secret', detail: '⚠️ AccessKeySecret 仅显示一次, 请立即下载 CSV 或复制保存' },
        { title: '配置域名权限', detail: '为该 AccessKey 添加 AliyunDomainFullAccess 系统策略 (或自定义策略仅授权域名相关 API)' },
        { title: '配置到本系统', detail: '将 AccessKeyId 填入 API Key, AccessKeySecret 填入 API Secret, 即可在本系统内管理阿里云域名' },
      ],
      credential_fields: [
        { key: 'api_key', label: 'AccessKeyId', type: 'text', required: true, placeholder: 'LTAI5tXXXXXXXXXX', help: '在阿里云控制台 AccessKey 管理创建, 建议用子账号' },
        { key: 'api_secret', label: 'AccessKeySecret', type: 'password', required: true, placeholder: '与 AccessKeyId 配套的 Secret', help: '⚠️ 创建时仅显示一次, 务必立即保存' },
      ],
      is_default: 0,
    },
    {
      // Tencent Cloud (腾讯云) — major Chinese registrar. SecretId + SecretKey, HMAC-SHA1 v3.
      code: 'tencent',
      name: '腾讯云',
      api_base_url: 'https://dnspod.tencentcloudapi.com',
      auth_type: 'bearer',
      capabilities: 'domains.list,domains.register,domains.renew,dns.list,dns.create,dns.update,dns.delete,quota',
      doc_url: 'https://cloud.tencent.com/document/product/1427',
      register_url: 'https://cloud.tencent.com/register',
      promo_url: 'https://cloud.tencent.com/',
      regions: 'CN',
      description: '国内主流域名注册商, 与 DNSPod 解析深度集成, 支持 .cn/.com 等所有主流后缀',
      commission_model: '按年付费, 首年优惠 (如 .com 首年 ¥35, 续费 ¥69), 需实名认证',
      registration_steps: [
        { title: '注册腾讯云账号', detail: '访问 cloud.tencent.com, 用微信/邮箱注册并完成实名认证 (个人/企业均可)' },
        { title: '申请 API 密钥', detail: '登录控制台 → 右上角头像 → 访问管理 → API 密钥管理 → 新建密钥 (建议使用子账号 + CAM 权限)' },
        { title: '保存 SecretId + SecretKey', detail: '⚠️ SecretKey 仅显示一次, 请立即复制保存, 否则只能重置' },
        { title: '配置域名权限', detail: '为该子账号添加 QcloudDomainPodFullAccess 策略 (或自定义策略仅授权域名相关 API)' },
        { title: '配置到本系统', detail: '将 SecretId 填入 API Key, SecretKey 填入 API Secret, 即可在本系统内管理腾讯云域名 + DNSPod 解析' },
      ],
      credential_fields: [
        { key: 'api_key', label: 'SecretId', type: 'text', required: true, placeholder: 'AKIDXXXXXXXXXX', help: '在腾讯云访问管理 → API 密钥管理创建, 建议用子账号' },
        { key: 'api_secret', label: 'SecretKey', type: 'password', required: true, placeholder: '与 SecretId 配套的 SecretKey', help: '⚠️ 创建时仅显示一次, 务必立即保存' },
      ],
      is_default: 0,
    },
    {
      // Cloudflare Registrar — at-cost registrar, reuses CF API token.
      code: 'cloudflare',
      name: 'Cloudflare Registrar',
      api_base_url: 'https://api.cloudflare.com/client/v4',
      auth_type: 'bearer',
      capabilities: 'domains.list,domains.register,domains.renew,dns.list,dns.create,dns.update,dns.delete,quota',
      doc_url: 'https://developers.cloudflare.com/api/resources/registrar/',
      register_url: 'https://dash.cloudflare.com/?to=/:account/domains',
      promo_url: 'https://www.cloudflare.com/products/registrar/',
      regions: 'GLOBAL',
      description: 'Cloudflare 自营域名注册商, 成本价续费 (无加价), 与 CF 生态深度集成',
      commission_model: '按年付费, 成本价 (如 .com $10.11/年, 续费同价, 不加价)',
      registration_steps: [
        { title: '注册 Cloudflare 账号', detail: '访问 dash.cloudflare.com/sign-up, 用邮箱注册 (免费)' },
        { title: '添加域名到 Cloudflare', detail: '在 Dashboard → Add a site, 输入域名并完成 NS 切换 (域名需先在其它注册商购买后转入 CF)' },
        { title: '创建 API Token', detail: 'Profile → API Tokens → Create Token → 选择「Edit zone DNS」模板或自定义' },
        { title: '配置 Token 权限', detail: '建议权限: Zone → DNS → Edit + Account → Account Settings → Read (按需添加 Registrar → Edit)' },
        { title: '配置到本系统', detail: '将 API Token 填入 API Key (CF 只需 Token, Secret 留空), 即可在本系统内管理 CF 域名 + DNS' },
      ],
      credential_fields: [
        { key: 'api_key', label: 'API Token', type: 'password', required: true, placeholder: '在 Profile → API Tokens 创建的 Token', help: '建议使用细粒度 API Token 而非 Global API Key' },
      ],
      is_default: 0,
    },
  ];
  const insertProviderStmt = db.prepare(`
    INSERT INTO domain_providers
      (code, name, api_base_url, auth_type, capabilities, doc_url, register_url, promo_url, regions,
       description, commission_model, registration_steps, credential_fields, is_default, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  // Update existing rows whose new columns are still default/empty so the
  // canonical metadata (capabilities, doc_url, regions, auth_type, promo_url,
  // registration_steps, credential_fields, ...) matches the seed definition.
  // This brings forward-compat to existing installs that were created before
  // v1.0.4 — they get the full registration flow metadata without losing
  // their existing rows.
  const updateProviderStmt = db.prepare(`
    UPDATE domain_providers
    SET auth_type           = COALESCE(NULLIF(auth_type, ''), ?),
        capabilities        = COALESCE(NULLIF(capabilities, ''), ?),
        doc_url             = COALESCE(NULLIF(doc_url, ''), ?),
        register_url        = COALESCE(NULLIF(register_url, ''), ?),
        promo_url           = COALESCE(NULLIF(promo_url, ''), ?),
        regions             = COALESCE(NULLIF(regions, ''), ?),
        description         = COALESCE(NULLIF(description, ''), ?),
        commission_model    = COALESCE(NULLIF(commission_model, ''), ?),
        registration_steps  = COALESCE(NULLIF(registration_steps, ''), ?),
        credential_fields   = COALESCE(NULLIF(credential_fields, ''), ?)
    WHERE code = ?
  `);
  for (const p of DEFAULT_PROVIDERS) {
    const exists = db.prepare('SELECT 1 FROM domain_providers WHERE code = ?').get(p.code);
    const stepsJson = JSON.stringify(p.registration_steps);
    const fieldsJson = JSON.stringify(p.credential_fields);
    if (!exists) {
      insertProviderStmt.run(
        p.code, p.name, p.api_base_url, p.auth_type, p.capabilities, p.doc_url,
        p.register_url, p.promo_url, p.regions, p.description, p.commission_model,
        stepsJson, fieldsJson, p.is_default,
      );
    } else {
      // Backfill missing metadata for previously-seeded rows. The COALESCE
      // means user edits to these fields are preserved — only NULL/empty
      // values get overwritten with the seed defaults.
      updateProviderStmt.run(
        p.auth_type, p.capabilities, p.doc_url, p.register_url, p.promo_url,
        p.regions, p.description, p.commission_model, stepsJson, fieldsJson, p.code,
      );
    }
  }

  const cols = db.prepare("PRAGMA table_info('accounts')").all() as { name: string }[];
  if (!cols.find(c => c.name === 'enabled_features')) {
    db.exec("ALTER TABLE accounts ADD COLUMN enabled_features TEXT DEFAULT 'ai,workers,browser_render,dns,storage'");
  }
  if (!cols.find(c => c.name === 'password')) {
    db.exec("ALTER TABLE accounts ADD COLUMN password TEXT");
  }
  if (!cols.find(c => c.name === 'available_features')) {
    db.exec("ALTER TABLE accounts ADD COLUMN available_features TEXT DEFAULT ''");
  }
  if (!cols.find(c => c.name === 'proxy_url')) {
    db.exec("ALTER TABLE accounts ADD COLUMN proxy_url TEXT DEFAULT ''");
  }
  if (!cols.find(c => c.name === 'proxy_enabled')) {
    db.exec("ALTER TABLE accounts ADD COLUMN proxy_enabled INTEGER DEFAULT 0");
  }

  // Migrate quota_usage: add exhausted column if not exists
  const quotaCols = db.prepare("PRAGMA table_info('quota_usage')").all() as { name: string }[];
  if (!quotaCols.find(c => c.name === 'exhausted')) {
    db.exec("ALTER TABLE quota_usage ADD COLUMN exhausted INTEGER DEFAULT 0");
  }
  if (!quotaCols.find(c => c.name === 'optimistic')) {
    db.exec("ALTER TABLE quota_usage ADD COLUMN optimistic INTEGER DEFAULT 0");
  }
}

export function getSetting(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  getDb().prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
}
