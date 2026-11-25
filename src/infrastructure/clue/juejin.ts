import type { ClueItem, ClueSourceAdapter } from "./types";
import { ZH_DEMAND_QUERIES, dedupeById, fetchText, stripHtml, toDate } from "./shared";

/** 掘金社区公开搜索接口（无需鉴权）：技术从业者的「求工具/求方案」帖。 */
interface JuejinArticleInfo {
  article_id?: string;
  title?: string;
  brief_content?: string;
  ctime?: string | number;
  user_id?: string | number;
}

interface JuejinRecord {
  result_model?: {
    article_info?: JuejinArticleInfo;
    author_user_info?: { user_name?: string; user_id?: string | number };
  };
}

interface JuejinResponse {
  data?: JuejinRecord[];
}

/** 纯解析：输入接口 JSON，输出统一线索（便于单测）。 */
export function parseJuejin(payload: unknown): ClueItem[] {
  const rows = (payload as JuejinResponse | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out: ClueItem[] = [];
  for (const row of rows) {
    const article = row?.result_model?.article_info;
    const title = stripHtml(String(article?.title ?? ""));
    const articleId = String(article?.article_id ?? "").trim();
    if (!title || !articleId) continue;
    out.push({
      sourceKey: "juejin",
      externalId: articleId,
      title,
      excerpt: stripHtml(String(article?.brief_content ?? "")),
      url: `https://juejin.cn/post/${articleId}`,
      authorId: String(
        row?.result_model?.author_user_info?.user_name ??
          row?.result_model?.author_user_info?.user_id ??
          "",
      ).trim(),
      mentionedAt: toDate(article?.ctime),
    });
  }
  return out;
}

export class JuejinClueSource implements ClueSourceAdapter {
  key = "juejin";
  name = "掘金";

  constructor(
    private readonly timeoutMs: number,
    private readonly queryList: readonly string[] = ZH_DEMAND_QUERIES,
  ) {}

  async fetch(): Promise<ClueItem[]> {
    const collected: ClueItem[] = [];
    let lastError: Error | null = null;

    for (const query of this.queryList) {
      try {
        const text = await fetchText(
          `https://api.juejin.cn/search_api/v1/search?query=${encodeURIComponent(query)}` +
            "&id_type=0&cursor=0&limit=20&search_type=0",
          this.timeoutMs,
        );
        collected.push(...parseJuejin(JSON.parse(text)));
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }

    if (collected.length === 0 && lastError) throw lastError;
    return dedupeById(collected);
  }
}
