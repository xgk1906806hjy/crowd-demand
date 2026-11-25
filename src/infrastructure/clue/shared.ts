/** 国内渠道共用工具：检索词、HTML 清洗、时间归一、浏览器 UA。 */

/** 站内检索用的中文「需求表达」检索词。各渠道逐词检索后合并去重。 */
export const ZH_DEMAND_QUERIES = [
  "有没有推荐的工具",
  "求推荐一款软件",
  "想找一个工具",
  "有没有什么好办法",
  "谁能帮我做一个",
  "求一款能自动的工具",
  "有没有类似的软件",
  "求推荐好用的app",
] as const;

/** 国内站点普遍拒绝非常规 UA，统一使用桌面浏览器 UA。 */
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** 去掉 HTML 标签、注释（含搜狗/CSDN 的 <em> 高亮与 <!--red_beg--> 标记）并解码常见实体。 */
export function stripHtml(input: string): string {
  return input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** 秒/毫秒时间戳统一转 Date；无效值回落到当前时间。 */
export function toDate(value: unknown, fallback: Date = new Date()): Date {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  const ms = num < 1e12 ? num * 1000 : num;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

/** 带超时的文本 GET（HTML/JSON 原文）。失败抛错，由上层按来源隔离。 */
export async function fetchText(
  url: string,
  timeoutMs: number,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "user-agent": BROWSER_UA,
      "accept-language": "zh-CN,zh;q=0.9",
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`来源请求失败 ${res.status}: ${url}`);
  return await res.text();
}

/** 按 externalId 去重（同一渠道多检索词的重复命中）。 */
export function dedupeById<T extends { externalId: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.externalId)) continue;
    seen.add(item.externalId);
    out.push(item);
  }
  return out;
}
