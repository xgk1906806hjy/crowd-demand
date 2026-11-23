import { centsToDisplay } from "@/lib/money";

/** 金额展示：入参为「分」的字符串或 bigint，输出 ¥1,234.00。 */
export function displayMoney(cents: string | bigint): string {
  const value = typeof cents === "string" ? BigInt(cents) : cents;
  return `¥${centsToDisplay(value)}`;
}

/** 日期：2026-11-21 */
export function displayDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 日期时间：2026-11-21 14:30 */
export function displayDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${displayDate(iso)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 剩余天数：用于征集/承诺倒计时。 */
export function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const end = new Date(iso).getTime();
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - Date.now()) / (24 * 3600 * 1000));
}
