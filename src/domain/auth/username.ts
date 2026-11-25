/**
 * 用户名规则（F32）：4-20 位，字母开头，仅字母/数字/下划线。
 * 大小写不敏感：存储与查询统一小写，防止大小写变体冒充。
 * 纯数字/含 @ 被格式规则天然排除，与手机号/邮箱标识空间隔离。
 */
export const USERNAME_MIN = 4;
export const USERNAME_MAX = 20;
export const USERNAME_RE = /^[a-z][a-z0-9_]{3,19}$/;

/** 保留词：防止冒充平台官方/管理员。 */
export const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "official",
  "service",
  "help",
]);

/** 归一化：去首尾空白 + 转小写。 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 校验用户名（输入须先归一化）。返回错误文案，合法返回 null。 */
export function validateUsername(username: string): string | null {
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return `用户名长度需为 ${USERNAME_MIN}-${USERNAME_MAX} 位`;
  }
  if (!USERNAME_RE.test(username)) {
    return "用户名需以字母开头，只能包含字母、数字和下划线";
  }
  if (RESERVED_USERNAMES.has(username)) {
    return "该用户名为系统保留，请换一个";
  }
  return null;
}