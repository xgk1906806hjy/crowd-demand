import type { ClueItem, ClueSourceAdapter } from "./types";
import { ZH_DEMAND_QUERIES, dedupeById, fetchText, stripHtml, toDate } from "./shared";

/**
 * 微信公众号文章检索（微信搜狗公开结果页，无需登录）。
 * 只取搜索结果卡片上的标题/摘要/时间/公众号名，不进入文章正文。
 */
const ITEM_RE = /<li id="sogou_vr_11002601_box_\d+"([^>]*)>([\s\S]*?)<\/li>/g;
const LINK_RE = /<h3>[\s\S]*?<a[^>]*?href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
const SUMMARY_RE = /<p class="txt-info"[^>]*>([\s\S]*?)<\/p>/;
const TIME_RE = /timeConvert\('(\d+)'\)/;
const AUTHOR_RE = /class="all-time-y2"[^>]*>([\s\S]*?)<\/span>/;
const FINGERPRINT_RE = /d="([^"]+)"/;

function absoluteLink(href: string): string {
  const cleaned = href.replace(/&amp;/g, "&").trim();
  if (!cleaned) return "";
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) return cleaned;
  return `https://weixin.sogou.com${cleaned}`;
}

/** 纯解析：输入搜索结果页 HTML，输出统一线索（便于单测）。 */
export function parseWeixin(html: string): ClueItem[] {
  const out: ClueItem[] = [];
  for (const block of html.matchAll(ITEM_RE)) {
    const body = block[2] ?? "";
    const fingerprint = FINGERPRINT_RE.exec(block[1] ?? "")?.[1] ?? "";
    const link = LINK_RE.exec(body);
    if (!link) continue;
    const href = link[1] ?? "";
    const url = absoluteLink(href);
    const title = stripHtml(link[2] ?? "");
    if (!url || !title) continue;

    const summary = SUMMARY_RE.exec(body);
    const time = TIME_RE.exec(body);
    const author = AUTHOR_RE.exec(body);
    const token = /token=([^&"]+)/.exec(href)?.[1];

    out.push({
      sourceKey: "weixin",
      externalId: fingerprint || token || url,
      title,
      excerpt: stripHtml(summary?.[1] ?? ""),
      url,
      authorId: stripHtml(author?.[1] ?? "").trim(),
      mentionedAt: toDate(time?.[1]),
    });
  }
  return out;
}

export class WeixinClueSource implements ClueSourceAdapter {
  key = "weixin";
  name = "微信公众号";

  constructor(
    private readonly timeoutMs: number,
    private readonly queryList: readonly string[] = ZH_DEMAND_QUERIES,
  ) {}

  async fetch(): Promise<ClueItem[]> {
    const collected: ClueItem[] = [];
    let lastError: Error | null = null;
    // 搜狗对连续请求较敏感：只取前 3 个检索词，并在两次请求间退避
    const queries = this.queryList.slice(0, 3);

    for (const [index, query] of queries.entries()) {
      if (index > 0) await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        const html = await fetchText(
          `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(query)}&ie=utf8`,
          this.timeoutMs,
        );
        collected.push(...parseWeixin(html));
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }

    // 拿到页面却没有结果块，多为限流/验证码拦截，抛错让后台看到来源异常而不是静默 0
    if (collected.length === 0) {
      throw lastError ?? new Error("搜索页无结果块（可能被限流或页面改版）");
    }
    return dedupeById(collected);
  }
}
