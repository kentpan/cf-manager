/**
 * 从邮箱中提取账户名：
 * - lauren.bailey2701@maildrop.cc -> bailey2701
 * - laurenbailey2701@maildrop.cc -> laurenbailey2701
 * - lauren.b.bailey2701@maildrop.cc -> bailey2701 (取最后一段)
 */
export function nameFromEmail(email: string): string {
  const localPart = (email.split('@')[0] || '').trim().toLowerCase();
  if (!localPart) return '';
  const parts = localPart.split('.');
  if (parts.length <= 1) {
    // 没有点：直接用完整本地部分
    return localPart;
  }
  // 有点：取最后一段（去掉中间名缩写等）
  return parts[parts.length - 1];
}
