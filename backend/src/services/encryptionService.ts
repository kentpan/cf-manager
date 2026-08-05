import crypto from 'crypto';
import { config } from '../config';

// 与 worker 端 WebCrypto AES-GCM 输出格式对齐：
//   iv(12B):ciphertext+tag(末尾16B)
// 旧格式（iv:tag:ciphertext, 3段, IV=16B）在 decrypt 中兼容回退。
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  if (!config.encryptionKey) {
    console.warn('[Encryption] ENCRYPTION_KEY not set, using default key. This is insecure for production!');
  }
  // 支持两种格式：
  // 1. 64位 hex 字符串（如 openssl rand -hex 32 生成）
  // 2. 任意长度字符串（自动 SHA-256 哈希为 32 字节）
  // 与 worker deriveKey 完全一致。
  const key = config.encryptionKey;
  if (/^[0-9a-fA-F]{64}$/.test(key)) {
    return Buffer.from(key, 'hex');
  }
  return crypto.createHash('sha256').update(key).digest();
}

export function encrypt(text: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // WebCrypto subtle.encrypt 输出 = ciphertext || tag，与下方拼接完全一致。
  return iv.toString('hex') + ':' + Buffer.concat([encrypted, tag]).toString('hex');
}

export function decrypt(encryptedText: string): string {
  const key = getKey();
  const parts = encryptedText.split(':');
  if (parts.length === 3) {
    // 旧格式 iv:tag:ciphertext — 历史数据向后兼容
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
  }
  // 新格式 iv:ciphertext+tag (与 worker 兼容)
  const iv = Buffer.from(parts[0], 'hex');
  const dataWithTag = Buffer.from(parts[1], 'hex');
  const tag = dataWithTag.subarray(dataWithTag.length - TAG_LENGTH);
  const encrypted = dataWithTag.subarray(0, dataWithTag.length - TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}
