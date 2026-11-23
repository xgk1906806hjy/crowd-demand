/**
 * 金额工具 —— 全项目金额一律用「分」（bigint）表示，禁止浮点数。
 * 仅在展示层格式化为元字符串。技术规则见 AGENTS.md 第 2 节。
 */

/** 元转分：仅接受字符串或整数，避免浮点误差。 */
export function yuanToCents(yuan: string | number): bigint {
  const s = typeof yuan === "number" ? String(yuan) : yuan;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new Error(`非法金额格式: ${yuan}`);
  }
  const [whole, frac = ""] = s.split(".");
  const cents = BigInt(whole ?? "0") * 100n + BigInt((frac ?? "").padEnd(2, "0"));
  return cents;
}

/** 分转元字符串（展示用），如 12345n -> "123.45"。 */
export function centsToYuan(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  const yuan = abs / 100n;
  const frac = abs % 100n;
  return `${sign}${yuan}.${frac.toString().padStart(2, "0")}`;
}

/** 带千分位的展示，如 123456789n -> "1,234,567.89"。 */
export function centsToDisplay(cents: bigint): string {
  const s = centsToYuan(cents);
  const [whole, frac] = s.split(".");
  const withSep = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${withSep}.${frac ?? "00"}`;
}

/** 校验金额为正数且在限额内。 */
export function assertAmountWithin(
  amount: bigint,
  { min = 1n, max }: { min?: bigint; max?: bigint } = {},
): void {
  if (amount < min) throw new Error(`金额不得低于 ${centsToYuan(min)} 元`);
  if (max !== undefined && amount > max) {
    throw new Error(`金额不得超过 ${centsToYuan(max)} 元`);
  }
}
