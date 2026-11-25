import type { ClueItem, ClueSourceAdapter } from "./types";
import { BROWSER_UA, ZH_DEMAND_QUERIES, dedupeById, fetchText, stripHtml, toDate } from "./shared";

/** CSDN 站内搜索公开接口（无需鉴权）：技术社区的「求工具/求方案」帖。 */
interface CsdnRow {
  articleid?: string | number;
  id?: string | number;
  title?: string;
  url?: string;
  description?: string;
  create_time?: string | number;
  nickname?: string;
}

interface CsdnResponse {
  result_vos?: CsdnRow[];
}

/** 纯解析：输入接口 JSON，输出统一线索（便于单测）。 */
export function parseCsdn(payload: unknown): ClueItem[] {
  const rows = (payload as CsdnResponse | null)?.result_vos;
  if (!Array.isArray(rows)) return [];
  const out: ClueItem[] = [];
  for (const row of rows) {
    const title = stripHtml(String(row.title ?? ""));
    const url = String(row.url ?? "").trim();
    if (!title || !url) continue;
    out.push({
      sourceKey: "csdn",
      externalId: String(row.articleid ?? row.id ?? url),
      title,
      excerpt: stripHtml(String(row.description ?? "")),
      url,
      authorId: String(row.nickname ?? "").trim(),
      mentionedAt: toDate(row.create_time),
    });
  }
  return out;
}

export class CsdnClueSource implements ClueSourceAdapter {
  key = "csdn";
  name = "CSDN";

  constructor(
    private readonly timeoutMs: number,
    private readonly queryList: readonly string[] = ZH_DEMAND_QUERIES,
  ) {}

  async fetch(): Promise<ClueItem[]> {
    const collected: ClueItem[] = [];
    let lastError: Error | null = null;

    // ask（ask.csdn.net 问答）更像真实提问，全部检索词都跑；blog 多为教程文，只跑前几个词补充
    const types: Array<{ type: "ask" | "blog"; queries: readonly string[] }> = [
      { type: "ask", queries: this.queryList },
      { type: "blog", queries: this.queryList.slice(0, 3) },
    ];

    for (const { type, queries } of types) {
      for (const query of queries) {
        try {
          const text = await fetchText(
            `https://so.csdn.net/api/v3/search?q=${encodeURIComponent(query)}&t=${type}&p=1`,
            this.timeoutMs,
            { referer: "https://so.csdn.net/" },
          );
          collected.push(...parseCsdn(JSON.parse(text)));
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
        }
      }
    }

    if (collected.length === 0 && lastError) throw lastError;
    return dedupeById(collected);
  }
}
