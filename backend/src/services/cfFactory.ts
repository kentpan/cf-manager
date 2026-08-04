import Cloudflare from 'cloudflare';
import { Account } from '../models/account';
import { decrypt } from './encryptionService';
import { getHttpAgentForAccount } from './proxyService';
import { appLogger } from './logger';

/**
 * Typed error raised when stored encrypted credentials cannot be decrypted
 * with the current ENCRYPTION_KEY. Callers can check `err.code === 'DECRYPT'`
 * to distinguish this from a Cloudflare API/network error and surface a
 * targeted "re-enter credentials" hint instead of a generic failure.
 */
export class DecryptError extends Error {
  code = 'DECRYPT' as const;
  accountId: number;
  constructor(accountId: number, cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to decrypt credentials for account ${accountId}: ${causeMsg}`);
    this.accountId = accountId;
    this.name = 'DecryptError';
    // Surface an actionable hint in the logs so the operator immediately
    // knows how to recover: either restore the original ENCRYPTION_KEY, or
    // wipe the broken credentials with the reset tool.
    appLogger.error(
      `[DecryptError] account ${accountId} — stored ciphertext cannot be decrypted ` +
      `with the current ENCRYPTION_KEY. Recovery options:\n` +
      `  1) Restore the original ENCRYPTION_KEY in cf-manager/.env (if known)\n` +
      `  2) Run: node scripts/reset-credentials.js --apply   (wipes broken fields, keeps account metadata)\n` +
      `  3) POST /api/accounts/reset-broken-credentials     (same, in-app)`
    );
  }
}

export function getAuthHeaders(account: Account): Record<string, string> {
  if (account.auth_type === 'token') {
    if (!account.api_token) throw new Error(`Account ${account.id} is missing api_token`);
    try {
      return { 'Authorization': `Bearer ${decrypt(account.api_token)}` };
    } catch (e) { throw new DecryptError(account.id, e); }
  }
  if (!account.api_key) throw new Error(`Account ${account.id} is missing api_key`);
  if (!account.email) throw new Error(`Account ${account.id} is missing email`);
  try {
    return { 'X-Auth-Email': account.email, 'X-Auth-Key': decrypt(account.api_key) };
  } catch (e) { throw new DecryptError(account.id, e); }
}

export function getCfClient(account: Account): Cloudflare {
  const httpAgent = getHttpAgentForAccount(account);
  const opts: Record<string, any> = {};
  if (httpAgent) opts.httpAgent = httpAgent;

  if (account.auth_type === 'token') {
    if (!account.api_token) throw new Error(`Account ${account.id} is missing api_token`);
    let plain: string;
    try { plain = decrypt(account.api_token); }
    catch (e) { throw new DecryptError(account.id, e); }
    return new Cloudflare({ apiToken: plain, ...opts });
  }
  if (!account.api_key) throw new Error(`Account ${account.id} is missing api_key`);
  if (!account.email) throw new Error(`Account ${account.id} is missing email`);
  let plainKey: string;
  try { plainKey = decrypt(account.api_key); }
  catch (e) { throw new DecryptError(account.id, e); }
  return new Cloudflare({ apiKey: plainKey, apiEmail: account.email, ...opts });
}

export function clearClientCache(): void {
  // No-op since we're not caching anymore
}
