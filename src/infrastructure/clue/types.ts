/** F29 采集来源适配器契约：只返回公开信息，不携带任何个人敏感数据。 */
export interface ClueItem {
  sourceKey: string;
  /** 来源侧唯一 ID（帖子 ID 等），与 sourceKey 联合幂等去重 */
  externalId: string;
  title: string;
  /** 公开正文摘要（入库前统一脱敏截断） */
  excerpt: string;
  url: string;
  /** 来源侧作者标识，仅用于生成不可逆哈希后丢弃 */
  authorId: string;
  mentionedAt: Date;
}

export interface ClueSourceAdapter {
  key: string;
  name: string;
  fetch(): Promise<ClueItem[]>;
}

/** 带超时的 JSON GET；失败抛错由上层按来源隔离。 */
export async function fetchJson<T>(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    headers: { "user-agent": "crowd-demand-clue-collector/1.0", ...headers },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`来源请求失败 ${res.status}: ${url}`);
  return (await res.json()) as T;
}
