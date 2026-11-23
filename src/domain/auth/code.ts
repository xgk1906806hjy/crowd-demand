import { createHash, randomInt, timingSafeEqual } from "node:crypto";

/** 生成 6 位数字验证码。 */
export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** 验证码哈希（禁止明文存储）。加固定 salt 后 sha256。 */
export function hashCode(code: string, target: string): string {
  return createHash("sha256").update(`${code}:${target}:cd-otp-v1`).digest("hex");
}

/** 恒定时间比较哈希，防时序攻击。 */
export function safeHashEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
