import { createHmac } from "node:crypto";

/**
 * 身份证号哈希 —— 用 HMAC-SHA256 + 服务端密钥。
 * 身份证号空间有限，普通哈希易被彩虹表反推，必须用带密钥的 HMAC。
 * 规则见 docs/F02-实名认证/功能详细说明.md 与 AGENTS.md 第 3 节。
 */
export function hashIdNumber(idNumber: string): string {
  const key = process.env.KYC_HASH_SECRET || process.env.AUTH_SECRET;
  if (!key) throw new Error("缺少 KYC_HASH_SECRET / AUTH_SECRET，无法计算身份证哈希");
  return createHmac("sha256", key).update(idNumber.trim().toUpperCase()).digest("hex");
}

/** 姓名脱敏：保留首字，其余替换为 *（如「张三丰」→「张**」）。 */
export function maskName(name: string): string {
  const chars = Array.from(name.trim());
  if (chars.length === 0) return "";
  const first = chars[0] ?? "";
  return first + "*".repeat(Math.max(chars.length - 1, 1));
}
