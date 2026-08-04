import type { Account } from '../db/models';
import { cfFetch, cfFetchPage, cfFetchAll } from './cfApi';

export interface TunnelAccountItem { id: number; name: string; account_id: string; }

export function listTunnelAccounts(accounts: Account[]): TunnelAccountItem[] {
  return accounts.filter((a) => !!a.account_id).map((a) => ({ id: a.id, name: a.name, account_id: a.account_id! }));
}

/**
 * List tunnels with pagination — only 1 subrequest per page.
 * Use this instead of listTunnels to avoid the 50-subrequest Workers limit.
 */
export async function listTunnelsPaged(account: Account, key: string, page: number = 1, perPage: number = 50) {
  return cfFetchPage<any>(account, `/accounts/${account.account_id}/cfd_tunnel`, key, page, perPage);
}

export async function listTunnels(account: Account, key: string): Promise<any[]> {
  return cfFetchAll<any>(account, `/accounts/${account.account_id}/cfd_tunnel`, key, 50, 10);
}

export async function createTunnel(account: Account, name: string, key: string): Promise<any> {
  return cfFetch(account, `/accounts/${account.account_id}/cfd_tunnel`, key, {
    method: 'POST', body: JSON.stringify({ name, config_src: 'cloudflare' }),
  });
}

export async function deleteTunnel(account: Account, tunnelId: string, key: string): Promise<any> {
  return cfFetch(account, `/accounts/${account.account_id}/cfd_tunnel/${tunnelId}`, key, { method: 'DELETE' });
}

export async function getTunnelToken(account: Account, tunnelId: string, key: string): Promise<string> {
  const res = await cfFetch<{ result: string }>(account, `/accounts/${account.account_id}/cfd_tunnel/${tunnelId}/token`, key);
  return res.result;
}

export async function getTunnelConnections(account: Account, tunnelId: string, key: string): Promise<any> {
  const res = await cfFetch<{ result: any[] }>(account, `/accounts/${account.account_id}/cfd_tunnel/${tunnelId}/connections`, key);
  return res.result;
}

export async function getTunnelConfig(account: Account, tunnelId: string, key: string): Promise<any[]> {
  const res = await cfFetch<{ result: { config: { ingress: any[] } } }>(account, `/accounts/${account.account_id}/cfd_tunnel/${tunnelId}/configurations`, key);
  return res.result?.config?.ingress ?? [];
}

export async function updateTunnelConfig(account: Account, tunnelId: string, ingress: Array<{ hostname?: string; service: string }>, key: string): Promise<any> {
  return cfFetch(account, `/accounts/${account.account_id}/cfd_tunnel/${tunnelId}/configurations`, key, {
    method: 'PUT', body: JSON.stringify({ config: { ingress } }),
  });
}

/**
 * 获取隧道绑定的域名列表：扫描账户下所有 zone 的 CNAME 记录，
 * 找到 content 为 {tunnelId}.cfargotunnel.com 的记录，返回其 name（hostname）。
 *
 * Workers 子请求优化：最多扫描 10 个 zone（每个 zone 1 个子请求），
 * 避免账号有大量 zone 时超过 50 子请求限制。如果 zone 数 > 10，
 * 只扫描前 10 个（大多数用户不会在 10+ zone 上绑定同一个 tunnel）。
 */
export async function listTunnelHostnames(account: Account, tunnelId: string, key: string): Promise<string[]> {
  const target = `${tunnelId}.cfargotunnel.com`;
  // Limit to first 10 zones to stay within Workers' 50-subrequest limit
  // (1 for zones list + 10 for DNS records = 11 subrequests max)
  const zones = await cfFetchAll<any>(account, '/zones', key, 50, 1); // maxPages=1 → first page only
  const zonesToCheck = zones.slice(0, 10); // cap at 10 zones
  const hostnames: string[] = [];
  for (const zone of zonesToCheck) {
    try {
      const records = await cfFetchPage<any>(account, `/zones/${zone.id}/dns_records?type=CNAME`, key, 1, 100);
      for (const r of records.items) {
        if (r.content === target) {
          hostnames.push(r.name);
        }
      }
    } catch {
      // 某些 zone 可能无权限，跳过
    }
  }
  return hostnames;
}
