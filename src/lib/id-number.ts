/**
 * 中国大陆 18 位居民身份证号校验（GB 11643-1999）。
 * 仅做格式与校验码校验，不联网核验；真实核验由 KycGateway 负责。
 */

const WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const;
const CHECK_CODES = "10X98765432";

export interface IdNumberInfo {
  birthDate: Date;
  gender: "M" | "F";
  regionCode: string;
}

export type IdNumberParseResult =
  | { ok: true; info: IdNumberInfo }
  | { ok: false; reason: string };

export function parseIdNumber(input: string): IdNumberParseResult {
  const id = input.trim().toUpperCase();
  if (!/^\d{17}[\dX]$/.test(id)) {
    return { ok: false, reason: "身份证号应为 18 位，前 17 位为数字，末位为数字或 X" };
  }

  const year = Number(id.slice(6, 10));
  const month = Number(id.slice(10, 12));
  const day = Number(id.slice(12, 14));
  if (year < 1900) return { ok: false, reason: "出生日期不合法" };

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { ok: false, reason: "出生日期不合法" };
  }

  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (date.getTime() > todayUtc) {
    return { ok: false, reason: "出生日期不合法" };
  }

  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const weight = WEIGHTS[i];
    if (weight === undefined) return { ok: false, reason: "身份证号不合法" };
    sum += Number(id.charAt(i)) * weight;
  }
  const expected = CHECK_CODES.charAt(sum % 11);
  if (id.charAt(17) !== expected) {
    return { ok: false, reason: "身份证号校验码错误" };
  }

  const genderDigit = Number(id.charAt(16));
  return {
    ok: true,
    info: {
      birthDate: date,
      gender: genderDigit % 2 === 1 ? "M" : "F",
      regionCode: id.slice(0, 6),
    },
  };
}
