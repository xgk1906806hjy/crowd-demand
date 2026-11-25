import { prisma } from "@/infrastructure/prisma/client";
import { env } from "@/lib/env";
import { createClueSources } from "@/infrastructure/clue/factory";
import { ZH_DEMAND_QUERIES } from "@/infrastructure/clue/shared";
import type { ClueItem } from "@/infrastructure/clue/types";
import { refineClues, isClueLlmEnabled } from "./enrich";
import { authorPseudonym, isLikelyNoise, looksLikeDemand, sanitizeExcerpt } from "./keywords";
import { listActiveQueries } from "./llm-search";
import { ClueService, type IngestSummary } from "./service";

/** 来源展示名：采集时确保 `DemandSource` 有记录，运营面板才能看到并启停新渠道 */
const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  csdn: "CSDN",
  weixin: "微信公众号",
  juejin: "掘金",
  douyin: "抖音",
  kuaishou: "快手",
  websearch: "联网搜索",
  v2ex: "V2EX",
  hn: "Hacker News",
  reddit: "Reddit 许愿板",
};

export interface CollectSummary {
  ran: boolean;
  reason?: "throttled" | "no-sources";
  sources: Record<string, { fetched?: number; error?: string }>;
  /** 轮次入库结果：v0.8 默认关闭（改由小时聚合统一入库），仅 CLUE_ROUND_INGEST=true 时有值 */
  ingest?: IngestSummary;
  /** 写入候选缓冲区的条数（供小时聚合消费） */
  candidates?: number;
  /** 本轮使用的模型生成检索词条数 */
  llmQueries?: number;
  /** 大模型整合结果：未配置 LLM_* 时 applied=false（走规则聚合） */
  llm?: { applied: boolean; dropped: number; provider?: string };
  ranAt: string;
}

/**
 * 采集编排（F29 v0.8）：
 * - 频率：cron 每 5 分钟触发，按 CLUE_INGEST_INTERVAL_MIN（默认 10 分钟）节流；
 * - 检索词：固定中文需求词 + 模型每小时生成的新词（库内最近 24 小时，最多 8 条）；
 * - 判定：单轮只做「真伪需求 + 标题归一」，结果写入 ClueCandidate 缓冲区；
 * - 入库：默认由小时聚合分析（analyze.ts）消费 6 轮候选后统一入库；
 *   CLUE_ROUND_INGEST=true 时退回旧行为，轮次直接入库；
 * - 来源级失败隔离：单个渠道超时不影响其他渠道。
 */
export async function collectClues(
  options: { force?: boolean; db?: typeof prisma } = {},
): Promise<CollectSummary> {
  const db = options.db ?? prisma;
  const now = new Date();
  const intervalMs = Math.max(Number(env.CLUE_INGEST_INTERVAL_MIN) || 10, 1) * 60_000;

  if (!options.force) {
    const state = await db.cronState.findUnique({ where: { key: "clue-ingest" } });
    if (state && now.getTime() - state.lastRunAt.getTime() < intervalMs) {
      return { ran: false, reason: "throttled", sources: {}, ranAt: now.toISOString() };
    }
  }

  // 模型生成的检索词：失败不影响采集，直接用固定词
  let llmQueries: string[] = [];
  try {
    llmQueries = await listActiveQueries(db, 8);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[clue] 读取模型检索词失败，使用固定词：${message}`);
  }

  const allAdapters = createClueSources(pickRoundQueries(llmQueries, now, intervalMs));
  // 为已配置的渠道补齐 DemandSource 记录（抖音/快手等新渠道即便本轮无产出也要出现在运营面板里可启停）
  for (const adapter of allAdapters) {
    try {
      await db.demandSource.upsert({
        where: { key: adapter.key },
        update: {},
        create: { key: adapter.key, name: SOURCE_DISPLAY_NAMES[adapter.key] ?? adapter.key },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[clue] 来源 ${adapter.key} 登记失败：${message}`);
    }
  }
  // 来源启停（运营面板可关停某渠道）：DB 里被停用的渠道本轮不抓取；
  // v0.8 候选不再经过 ingest 的 enabled 校验，因此必须在这里拦住，否则停用形同虚设。
  const sourceRows = await db.demandSource.findMany({ select: { key: true, enabled: true } });
  const disabled = new Set(sourceRows.filter((s) => !s.enabled).map((s) => s.key));
  const adapters = allAdapters.filter((a) => !disabled.has(a.key));
  if (adapters.length === 0) {
    return { ran: false, reason: "no-sources", sources: {}, ranAt: now.toISOString() };
  }
  const perSource: CollectSummary["sources"] = {};
  const sourceLists: ClueItem[][] = [];
  for (const adapter of adapters) {
    try {
      const items = await adapter.fetch();
      perSource[adapter.key] = { fetched: items.length };
      sourceLists.push(items);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      perSource[adapter.key] = { error: message.slice(0, 200) };
      console.warn(`[clue] 来源 ${adapter.key} 采集失败：${message}`);
    }
  }
  // 按渠道交错合并：候选超出单轮模型处理上限时，各渠道都能进入判定，不会被排在最后的一整源截断
  const all: ClueItem[] = [];
  const maxLen = sourceLists.reduce((max, list) => Math.max(max, list.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const list of sourceLists) {
      const item = list[i];
      if (item) all.push(item);
    }
  }

  // 排除已处理过的候选（已入提及或已进缓冲区），避免每轮重复送模型
  const existing = await db.clueMention.findMany({ select: { sourceKey: true, externalId: true } });
  const buffered = await db.clueCandidate.findMany({ select: { sourceKey: true, externalId: true } });
  const seen = new Set(
    [...existing, ...buffered].map((row) => `${row.sourceKey}:${row.externalId}`),
  );
  const llmOn = isClueLlmEnabled();
  const fresh = all.filter((item) => {
    if (seen.has(`${item.sourceKey}:${item.externalId}`)) return false;
    const text = `${item.title ?? ""} ${item.excerpt ?? ""}`;
    if (isLikelyNoise(text)) return false;
    return llmOn ? true : looksLikeDemand(text);
  });
  const refined = await refineClues(fresh);

  // 写入候选缓冲区：小时聚合会把这 6 轮候选合并后再交模型聚类
  const roundId = now.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const rows = refined.items
    .filter((item) => item.externalId && item.title.trim())
    .map((item) => ({
      sourceKey: item.sourceKey,
      externalId: item.externalId,
      title: item.title.trim().slice(0, 120),
      excerpt: sanitizeExcerpt(item.excerpt ?? ""),
      url: item.url,
      authorKey: authorPseudonym(item.sourceKey, item.authorId || item.externalId),
      mentionedAt:
        item.mentionedAt instanceof Date && !Number.isNaN(item.mentionedAt.getTime())
          ? item.mentionedAt
          : now,
      roundId,
    }));
  let candidateCount = 0;
  if (rows.length > 0) {
    const written = await db.clueCandidate.createMany({ data: rows, skipDuplicates: true });
    candidateCount = written.count;
  }

  const roundIngest = env.CLUE_ROUND_INGEST === "true";
  const result = roundIngest
    ? await new ClueService(db).ingest(refined.items, { requireDemandSignal: !llmOn })
    : null;

  await db.cronState.upsert({
    where: { key: "clue-ingest" },
    update: { lastRunAt: now },
    create: { key: "clue-ingest", lastRunAt: now },
  });

  return {
    ran: true,
    sources: perSource,
    ingest: result?.ok ? result.value : undefined,
    candidates: candidateCount,
    llmQueries: llmQueries.length,
    llm: { applied: refined.applied, dropped: refined.dropped, provider: refined.provider },
    ranAt: now.toISOString(),
  };
}

/**
 * 按轮次轮换检索词（F29 v0.8）。
 * 全部检索词（固定词 + 模型词）一次性下发会让每轮都重抓同样的结果页、并把数百条候选送进大模型，
 * 单轮耗时可达二三十分钟，与 10 分钟节奏冲突；因此每轮只取 `CLUE_QUERIES_PER_ROUND` 条（默认 4），
 * 按轮次序号在整份词表上滑动，一小时 6 轮即可覆盖全部检索词。
 */
export function pickRoundQueries(
  llmQueries: readonly string[],
  now: Date,
  intervalMs: number,
  perRound = Math.max(Number(env.CLUE_QUERIES_PER_ROUND) || 4, 1),
): string[] {
  const all: string[] = [];
  const seen = new Set<string>();
  for (const q of [...ZH_DEMAND_QUERIES, ...llmQueries]) {
    const v = q.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    all.push(v);
  }
  if (all.length === 0) return [];
  const size = Math.min(perRound, all.length);
  const roundNo = Math.floor(now.getTime() / Math.max(intervalMs, 1));
  const start = (roundNo * size) % all.length;
  const out: string[] = [];
  for (let i = 0; i < size; i++) out.push(all[(start + i) % all.length]!);
  return out;
}
