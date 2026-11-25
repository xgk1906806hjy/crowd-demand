import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LEN = 32;

/** 密码规则（2026-11-23 变更）：固定 8 位，数字开头，含大写/小写字母与特殊符号。 */
export const PASSWORD_LEN = 8;

/** 英文特殊符号（可打印 ASCII 标点）。 */
const SPECIAL_RE = /[!-\/:-@\[-`{-~]/;

/** 密码强度校验：返回错误文案，合法返回 null。 */
export function validatePasswordStrength(password: string): string | null {
  if (password.length !== PASSWORD_LEN) {
    return `密码长度需为 ${PASSWORD_LEN} 位`;
  }
  if (!/^[\x21-\x7E]+$/.test(password)) {
    return "密码只能包含字母、数字和英文特殊符号（不含空格）";
  }
  if (!/^[0-9]/.test(password)) {
    return "密码需以数字开头";
  }
  if (!/[A-Z]/.test(password)) {
    return "密码需包含大写字母";
  }
  if (!/[a-z]/.test(password)) {
    return "密码需包含小写字母";
  }
  if (!SPECIAL_RE.test(password)) {
    return "密码需包含特殊符号（如 !@#$%^&*）";
  }
  return null;
}

/** scrypt 哈希，随机盐；存储格式 scrypt$<saltHex>$<hashHex>。禁止明文/可逆存储。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** 恒定时间比对密码。格式非法一律返回 false。 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, saltHex, hashHex] = parts;
  if (!saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, "hex");
    const derived = await scrypt(password, Buffer.from(saltHex, "hex"), KEY_LEN, SCRYPT_PARAMS);
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
