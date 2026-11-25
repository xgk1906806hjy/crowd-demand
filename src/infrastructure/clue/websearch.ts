import type { ClueItem, ClueSourceAdapter } from "./types";
import { ZH_DEMAND_QUERIES, dedupeById, stripHtml, toDate } from "./shared";

/**
 * 联网搜索 API 来源（F29 v0.8，「用大模型搜索」的第二条腿）。
 *
 * 只有在配置 `CLUE_SEARCH_API_URL`（+ 可选 `CLUE_SEARCH_API_KEY`）时启用；
 * 未配置时工厂不注册该来源，行为与现在完全一致。
 *
 * 请求：`POST {url}`，body `{ query, count }`，`Authorization: Bearer <key>`（有 key 时）。
 * 响应解析做了宽松适配，兼容常见返回结构：
 * - `{ data: [{ title, url, snippet, publishTime }] }`
 * - `{ results: [...] }`
 * - `{ web: { value: [{ name, url, snippet, dateLastCrawled }] } }`（Bing 风格）
 * - `{ webPages: { value: [...] } }`、`{ organic_results: [...] }`（Serper 风格）
 */
interface RawResult {
  title?: unknown;
  name?: unknown;
  url?: unknown;
  link?: unknown;
  snippet?: unknown;
  description?: unknown;
  content?: unknown;
  publishTime?: unknown;
  date?: unknown;
  dateLastCrawled?: unknown;
}

/** 纯解析：把不同搜索 API 的返回统一成线索（便于单测）。 */
export function parseSearchResponse(payload: unknown): RawResult[] {
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  const candidates: unknown[] = [
    obj.data,
    obj.results,
    obj.organic_results,
    (obj.web as Record<string, unknown> | undefined)?.value,
    (obj.webPages as Record<string, unknown> | undefined)?.value,
  ];
  const list = candidates.find((c) => Array.isArray(c) && c.length > 0);
  return Array.isArray(list) ? (list as RawResult[]) : [];
}

export class WebSearchClueSource implements ClueSourceAdapter {
  key = "websearch";
  name = "联网搜索";

  constructor(
    private readonly timeoutMs: number,
    private readonly apiUrl: string,
    private readonly apiKey: string | undefined,
    private readonly queries: readonly string[] = ZH_DEMAND_QUERIES.slice(0, 5),
  ) {}

  async fetch(): Promise<ClueItem[]> {
    const collected: ClueItem[] = [];
    let lastError: Error | null = null;
    for (const query of this.queries) {
      try {
        const res = await fetch(this.apiUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({ query, count: 20 }),
          signal: AbortSignal.timeout(this.timeoutMs),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`搜索接口 ${res.status}`);
        const payload: unknown = await res.json();
        for (const row of parseSearchResponse(payload)) {
          const title = stripHtml(String(row.title ?? row.name ?? ""));
          const url = String(row.url ?? row.link ?? "").trim();
          if (!title || !url) continue;
          collected.push({
            sourceKey: "websearch",
            externalId: url,
            title: title.slice(0, 120),
            excerpt: stripHtml(String(row.snippet ?? row.description ?? row.content ?? "")),
            url,
            authorId: new URL(url).hostname,
            mentionedAt: toDate(row.publishTime ?? row.date ?? row.dateLastCrawled),
          });
        }
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }
    if (collected.length === 0 && lastError) throw lastError;
    return dedupeById(collected);
  }
}

/** 供工厂判断：未配置地址就不注册该来源。 */
export function isWebSearchConfigured(url: string | undefined): url is string {
  return typeof url === "string" && url.startsWith("http");
}
