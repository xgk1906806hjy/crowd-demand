import { env } from "@/lib/env";
import type { ClueSourceAdapter } from "./types";
import { CsdnClueSource } from "./csdn";
import { WeixinClueSource } from "./weixin";
import { JuejinClueSource } from "./juejin";
import { V2exClueSource } from "./v2ex";
import { HackerNewsClueSource } from "./hn";
import { RedditClueSource } from "./reddit";
import { DouyinClueSource } from "./douyin";
import { KuaishouClueSource } from "./kuaishou";
import { WebSearchClueSource, isWebSearchConfigured } from "./websearch";
import { ZH_DEMAND_QUERIES } from "./shared";

/** 支持的来源 key（用于日志与文档提示）。 */
export const CLUE_SOURCE_KEYS = [
  "csdn",
  "weixin",
  "juejin",
  "douyin",
  "kuaishou",
  "websearch",
  "hn",
  "v2ex",
  "reddit",
] as const;

/**
 * 按 CLUE_SOURCES（逗号分隔）构造来源适配器。
 * 国内：csdn / weixin / juejin / douyin / kuaishou / websearch（需配置搜索 API）
 * 海外：hn / v2ex / reddit。
 * 全部为公开页面或公开接口、零新增依赖；演示数据源已移除（F29 v0.4）。
 * `queries` 为本轮实际使用的检索词（v0.8：由调用方把固定词与模型词合并后按轮次轮换下发）。
 * 未知 key 忽略并告警，避免拼写错误导致静默不采集。
 */
export function createClueSources(
  queries: readonly string[] = ZH_DEMAND_QUERIES,
): ClueSourceAdapter[] {
  const keys = env.CLUE_SOURCES.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const timeout = Number(env.CLUE_FETCH_TIMEOUT_MS);
  const qs = dedupeQueries(queries.length > 0 ? queries : ZH_DEMAND_QUERIES);
  const out: ClueSourceAdapter[] = [];
  for (const key of keys) {
    switch (key) {
      case "csdn":
        out.push(new CsdnClueSource(timeout, qs));
        break;
      case "weixin":
        out.push(new WeixinClueSource(timeout, qs));
        break;
      case "juejin":
        out.push(new JuejinClueSource(timeout, qs));
        break;
      case "douyin":
        out.push(new DouyinClueSource(timeout, qs));
        break;
      case "kuaishou":
        out.push(new KuaishouClueSource(timeout, qs));
        break;
      case "websearch":
        if (isWebSearchConfigured(env.CLUE_SEARCH_API_URL)) {
          out.push(
            new WebSearchClueSource(timeout, env.CLUE_SEARCH_API_URL, env.CLUE_SEARCH_API_KEY, qs),
          );
        } else {
          console.warn("[clue] 来源 websearch 未配置 CLUE_SEARCH_API_URL，已跳过");
        }
        break;
      case "v2ex":
        out.push(new V2exClueSource(timeout));
        break;
      case "hn":
        out.push(new HackerNewsClueSource(timeout));
        break;
      case "reddit":
        out.push(new RedditClueSource(timeout));
        break;
      default:
        console.warn(
          `[clue] 未知采集来源 "${key}"，已忽略（可选：${CLUE_SOURCE_KEYS.join(",")}）`,
        );
    }
  }
  return out;
}

function dedupeQueries(list: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of list) {
    const v = q.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
