import type { ClueItem, ClueSourceAdapter } from "./types";
import { fetchJson } from "./types";

/** Reddit r/SomebodyMakeThis（公开 JSON，无需鉴权）：天然的需求许愿社区。 */
interface RedditResponse {
  data?: {
    children?: Array<{
      data?: {
        id: string;
        title?: string;
        selftext?: string;
        permalink?: string;
        author?: string;
        created_utc?: number;
      };
    }>;
  };
}

export class RedditClueSource implements ClueSourceAdapter {
  key = "reddit";
  name = "Reddit 许愿板";

  constructor(private readonly timeoutMs: number) {}

  async fetch(): Promise<ClueItem[]> {
    const data = await fetchJson<RedditResponse>(
      "https://www.reddit.com/r/SomebodyMakeThis/new.json?limit=50",
      this.timeoutMs,
    );
    const out: ClueItem[] = [];
    for (const c of data.data?.children ?? []) {
      const d = c.data;
      if (!d?.id) continue;
      out.push({
        sourceKey: this.key,
        externalId: d.id,
        title: String(d.title ?? ""),
        excerpt: String(d.selftext ?? "").slice(0, 500),
        url: `https://www.reddit.com${d.permalink ?? ""}`,
        authorId: String(d.author ?? d.id),
        mentionedAt: new Date((d.created_utc ?? 0) * 1000),
      });
    }
    return out;
  }
}
