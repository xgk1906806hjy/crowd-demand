import type { ClueItem, ClueSourceAdapter } from "./types";
import { ZH_DEMAND_QUERIES, dedupeById, fetchText, stripHtml, toDate } from "./shared";

/**
 * 抖音公开搜索页（尽力而为，F29 v0.8）。
 *
 * 约束：抖音站内搜索接口需要 `a_bogus`/`X-Bogus` 签名，评论区需要登录态，
 * 按合规口径不做绕过。这里只请求公开搜索页 `www.douyin.com/search/{kw}`，
 * 尝试从页面内嵌的 SSR 数据（`window._ROUTER_DATA`）里取标题与描述；
 * 页面改版或需要 JS 渲染时解析不到内容，按来源级失败隔离，不影响其他渠道。
 */
const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

interface DouyinAweme {
  aweme_id?: string;
  desc?: string;
  create_time?: number | string;
  author?: { nickname?: string; uid?: string };
  share_url?: string;
}

/** 纯解析：从搜索页 HTML 中抽取 SSR JSON 里的作品列表（便于单测）。 */
export function parseDouyin(html: string): ClueItem[] {
  const marker = /window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/.exec(html);
  if (!marker?.[1]) return [];
  let data: unknown;
  try {
    data = JSON.parse(marker[1]);
  } catch {
    return [];
  }
  const out: ClueItem[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const record = node as Record<string, unknown>;
    const aweme = record.aweme_info as DouyinAweme | undefined;
    if (aweme?.aweme_id && aweme.desc) {
      const id = String(aweme.aweme_id);
      const desc = stripHtml(String(aweme.desc));
      out.push({
        sourceKey: "douyin",
        externalId: id,
        title: desc.slice(0, 100),
        excerpt: desc.slice(0, 300),
        url: aweme.share_url ?? `https://www.douyin.com/video/${id}`,
        authorId: String(aweme.author?.uid ?? aweme.author?.nickname ?? ""),
        mentionedAt: toDate(aweme.create_time),
      });
    }
    for (const value of Object.values(record)) walk(value);
  };
  walk(data);
  return out;
}

export class DouyinClueSource implements ClueSourceAdapter {
  key = "douyin";
  name = "抖音";

  constructor(
    private readonly timeoutMs: number,
    private readonly queries: readonly string[] = ZH_DEMAND_QUERIES,
  ) {}

  async fetch(): Promise<ClueItem[]> {
    const collected: ClueItem[] = [];
    let lastError: Error | null = null;
    // 搜索页请求较重，单轮只跑前 3 个检索词，避免 10 分钟一轮把页面打成限流
    for (const query of this.queries.slice(0, 3)) {
      try {
        const html = await fetchText(
          `https://www.douyin.com/search/${encodeURIComponent(query)}?type=general`,
          this.timeoutMs,
          { "user-agent": UA_MOBILE, referer: "https://www.douyin.com/" },
        );
        collected.push(...parseDouyin(html));
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }
    if (collected.length === 0) {
      throw new Error(
        `抖音公开搜索页无可用结果（需 JS 渲染或签名，按合规不绕过）${lastError ? `：${lastError.message}` : ""}`,
      );
    }
    return dedupeById(collected);
  }
}
