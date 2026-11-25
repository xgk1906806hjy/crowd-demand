import type { ClueItem, ClueSourceAdapter } from "./types";
import { ZH_DEMAND_QUERIES, dedupeById, fetchText, stripHtml, toDate } from "./shared";

/**
 * 快手公开搜索页（尽力而为，F29 v0.8）。
 *
 * 约束：快手站内搜索接口需要签名与登录态，评论区同理；按合规口径不做绕过。
 * 这里只请求公开搜索页，尝试从页面内嵌的 `window.__APOLLO_STATE__` 里取作品标题；
 * 页面改版或完全 JS 渲染时解析不到内容，按来源级失败隔离处理。
 */
const UA_MOBILE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

interface KuaishouPhoto {
  id?: string;
  caption?: string;
  photoId?: string;
  timestamp?: number | string;
  userName?: string;
  userId?: string;
}

/** 纯解析：从搜索页 HTML 的 Apollo 缓存中抽取作品（便于单测）。 */
export function parseKuaishou(html: string): ClueItem[] {
  const marker = /window\.__APOLLO_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/.exec(html);
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
    const photo = record as KuaishouPhoto;
    const id = photo.photoId ?? photo.id;
    const caption = photo.caption;
    if (id && caption) {
      const text = stripHtml(String(caption));
      out.push({
        sourceKey: "kuaishou",
        externalId: String(id),
        title: text.slice(0, 100),
        excerpt: text.slice(0, 300),
        url: `https://www.kuaishou.com/short-video/${id}`,
        authorId: String(photo.userId ?? photo.userName ?? ""),
        mentionedAt: toDate(photo.timestamp),
      });
    }
    for (const value of Object.values(record)) walk(value);
  };
  walk(data);
  return out;
}

export class KuaishouClueSource implements ClueSourceAdapter {
  key = "kuaishou";
  name = "快手";

  constructor(
    private readonly timeoutMs: number,
    private readonly queries: readonly string[] = ZH_DEMAND_QUERIES,
  ) {}

  async fetch(): Promise<ClueItem[]> {
    const collected: ClueItem[] = [];
    let lastError: Error | null = null;
    for (const query of this.queries.slice(0, 3)) {
      try {
        const html = await fetchText(
          `https://www.kuaishou.com/search/video?searchKey=${encodeURIComponent(query)}`,
          this.timeoutMs,
          { "user-agent": UA_MOBILE, referer: "https://www.kuaishou.com/" },
        );
        collected.push(...parseKuaishou(html));
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }
    if (collected.length === 0) {
      throw new Error(
        `快手公开搜索页无可用结果（需 JS 渲染或签名，按合规不绕过）${lastError ? `：${lastError.message}` : ""}`,
      );
    }
    return dedupeById(collected);
  }
}
