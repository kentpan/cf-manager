-- ============================================================
-- D1 列级迁移脚本
-- 
-- 此文件包含所有需要通过 ALTER TABLE 添加的列。
-- D1 不支持 "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" 语法，
-- 所以在 deploy-cf.yml 中执行时会用 "|| true" 忽略"列已存在"错误。
--
-- 新增列时：只需在此文件末尾追加 ALTER TABLE 语句即可，
-- 无需修改 deploy-cf.yml。
-- ============================================================

-- --- accounts 表 ---
ALTER TABLE accounts ADD COLUMN enabled_features TEXT DEFAULT 'ai,workers,browser_render,dns,storage';
ALTER TABLE accounts ADD COLUMN password TEXT;
ALTER TABLE accounts ADD COLUMN available_features TEXT DEFAULT '';
ALTER TABLE accounts ADD COLUMN proxy_url TEXT DEFAULT '';
ALTER TABLE accounts ADD COLUMN proxy_enabled INTEGER DEFAULT 0;

-- --- quota_usage 表 ---
ALTER TABLE quota_usage ADD COLUMN optimistic INTEGER DEFAULT 0;
ALTER TABLE quota_usage ADD COLUMN exhausted INTEGER DEFAULT 0;

-- --- domain_providers 表（种子数据，幂等）---
-- D1 不支持 INSERT ... ON CONFLICT，所以用 INSERT OR IGNORE 兜底
INSERT OR IGNORE INTO domain_providers (code, name, api_base_url, auth_type, capabilities, doc_url, regions, promo_url, is_default, enabled) VALUES ('dnshe', 'DNSHE', 'https://api005.dnshe.com/index.php', 'header', 'domains.list,domains.register,domains.delete,domains.renew,dns.list,dns.create,dns.update,dns.delete,quota', 'https://my.dnshe.com/knowledgebase/13/DNSHE%E5%85%8D%E8%B4%B9%E5%9F%9F%E5%90%8DAPI%E4%BD%BF%E7%94%A8%E6%96%87%E6%A1%A3V2.0.html', 'GLOBAL', 'https://my.dnshe.com/go.php?code=KRDQzaIlJb', 1, 1);
INSERT OR IGNORE INTO domain_providers (code, name, api_base_url, auth_type, capabilities, doc_url, regions, promo_url, is_default, enabled) VALUES ('porkbun', 'Porkbun', 'https://api.porkbun.com/api/json/v3', 'bearer', 'domains.list,dns.list,dns.create,dns.update,dns.delete', 'https://porkbun.com/api/apiDoc', 'GLOBAL', 'https://porkbun.com/', 0, 1);
INSERT OR IGNORE INTO domain_providers (code, name, api_base_url, auth_type, capabilities, doc_url, regions, promo_url, is_default, enabled) VALUES ('namesilo', 'Namesilo', 'https://www.namesilo.com/api/', 'query', 'domains.list,domains.register,domains.renew,dns.list,dns.create,dns.update,dns.delete', 'https://www.namesilo.com/api-reference', 'GLOBAL', 'https://www.namesilo.com/', 0, 1);
INSERT OR IGNORE INTO domain_providers (code, name, api_base_url, auth_type, capabilities, doc_url, regions, promo_url, is_default, enabled) VALUES ('namecheap', 'Namecheap', 'https://api.namecheap.com/xml.response', 'query', 'domains.list,domains.register,domains.renew,dns.list,dns.create,dns.update,dns.delete', 'https://www.namecheap.com/support/api/methods/', 'GLOBAL', 'https://www.namecheap.com/', 0, 1);
INSERT OR IGNORE INTO domain_providers (code, name, api_base_url, auth_type, capabilities, doc_url, regions, promo_url, is_default, enabled) VALUES ('godaddy', 'GoDaddy', 'https://api.godaddy.com/v1', 'bearer', 'domains.list,domains.renew,dns.list,dns.create,dns.update,dns.delete', 'https://developer.godaddy.com/doc', 'GLOBAL', 'https://www.godaddy.com/', 0, 1);
INSERT OR IGNORE INTO domain_providers (code, name, api_base_url, auth_type, capabilities, doc_url, regions, promo_url, is_default, enabled) VALUES ('dynadot', 'Dynadot', 'https://api.dynadot.com/api3.json', 'query', 'domains.list,domains.register,domains.renew,dns.list,dns.create,dns.update,dns.delete', 'https://www.dynadot.com/domain/api3-doc.html', 'GLOBAL', 'https://www.dynadot.com/', 0, 1);
INSERT OR IGNORE INTO domain_providers (code, name, api_base_url, auth_type, capabilities, doc_url, regions, promo_url, is_default, enabled) VALUES ('aliyun', '阿里云', 'https://domain.aliyuncs.com', 'bearer', 'domains.list,domains.register,domains.renew,dns.list,dns.create,dns.update,dns.delete,quota', 'https://help.aliyun.com/document_detail/89847.html', 'CN', 'https://www.aliyun.com/', 0, 1);
INSERT OR IGNORE INTO domain_providers (code, name, api_base_url, auth_type, capabilities, doc_url, regions, promo_url, is_default, enabled) VALUES ('tencent', '腾讯云', 'https://dnspod.tencentcloudapi.com', 'bearer', 'domains.list,domains.register,domains.renew,dns.list,dns.create,dns.update,dns.delete,quota', 'https://cloud.tencent.com/document/product/1427', 'CN', 'https://cloud.tencent.com/', 0, 1);
INSERT OR IGNORE INTO domain_providers (code, name, api_base_url, auth_type, capabilities, doc_url, regions, promo_url, is_default, enabled) VALUES ('cloudflare', 'Cloudflare Registrar', 'https://api.cloudflare.com/client/v4', 'bearer', 'domains.list,domains.register,domains.renew,dns.list,dns.create,dns.update,dns.delete,quota', 'https://developers.cloudflare.com/api/resources/registrar/', 'GLOBAL', 'https://www.cloudflare.com/products/registrar/', 0, 1);
