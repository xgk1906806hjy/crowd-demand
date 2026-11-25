import type { ClueItem, ClueSourceAdapter } from "./types";
import { fetchJson } from "./types";

/** Hacker News（Algolia 公开检索 API）：抓「I wish there was / somebody make」类需求表达。 */
interface HnResponse {
  hits?: Array<{
    objectID: string;
    title?: string | null;
    story_text?: string | null;
    url?: string | null;
    author?: string;
    created_at_i?: number;
  }>;
}

const QUERIES = ["I wish there was", "somebody make", "is there a tool"];

export class HackerNewsClueSource implements ClueSourceAdapter {
  key = "hn";
  name = "Hacker News";

  constructor(private readonly timeoutMs: number) {}

  async fetch(): Promise<ClueItem[]> {
    const out: ClueItem[] = [];
    for (const q of QUERIES) {
      const data = await fetchJson<HnResponse>(
        `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(`"${q}"`)}&tags=story&hitsPerPage=30`,
        this.timeoutMs,
      );
      for (const h of data.hits ?? []) {
        out.push({
          sourceKey: this.key,
          externalId: h.objectID,
          title: String(h.title ?? ""),
          excerpt: String(h.story_text ?? "").slice(0, 500),
          url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
          authorId: String(h.author ?? h.objectID),
          mentionedAt: new Date((h.created_at_i ?? 0) * 1000),
        });
      }
    }
    return out;
  }
}
