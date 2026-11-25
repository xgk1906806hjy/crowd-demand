import type { ClueItem, ClueSourceAdapter } from "./types";
import { fetchJson } from "./types";

/** V2EX 热门主题（公开 API，无需鉴权）。只取内容，作者仅用于哈希去重。 */
interface V2exTopic {
  id: number;
  title: string;
  content?: string;
  url: string;
  created: number;
  member?: { username?: string };
}

export class V2exClueSource implements ClueSourceAdapter {
  key = "v2ex";
  name = "V2EX";

  constructor(private readonly timeoutMs: number) {}

  async fetch(): Promise<ClueItem[]> {
    const topics = await fetchJson<V2exTopic[]>(
      "https://www.v2ex.com/api/topics/hot.json",
      this.timeoutMs,
    );
    if (!Array.isArray(topics)) return [];
    return topics.slice(0, 50).map((t) => ({
      sourceKey: this.key,
      externalId: String(t.id),
      title: String(t.title ?? ""),
      excerpt: String(t.content ?? "").slice(0, 500),
      url: String(t.url ?? ""),
      authorId: String(t.member?.username ?? `t${t.id}`),
      mentionedAt: new Date((t.created ?? 0) * 1000),
    }));
  }
}
