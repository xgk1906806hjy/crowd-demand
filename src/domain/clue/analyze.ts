import { prisma } from "@/infrastructure/prisma/client";
import { env } from "@/lib/env";
import type { ClueItem } from "@/infrastructure/clue/types";
import { callLlm, isClueLlmEnabled } from "./enrich";
import { extractKeywords, isSamePain } from "./keywords";
import { ClueService, type IngestSummary } from "./service";

export interface HourlySummary {
  ran: boolean;
  reason?: "throttled" | "no-candidates" | "no-clusters";
  /** 本次窗口内参与聚合的候选条数 */
  candidates: number;
  /** 模型（或规则兜底）合并出的需求组数 */
  clusters: number;
  /** 各组平均重复条数（衡量「重复次数最多」） */
  avgRepeat?: number;
  ingest?: IngestSummary;
  /** 本轮顺带生成的新检索词条数 */
  newQueries?: number;
  provider?: string;
  ranAt: string;
}

/**
 * 小时聚合分析提示词（F29 v0.8）。
 * 与单轮判定不同，这里面对的是「同一小时内的多条候选」，核心任务是**跨条合并去重**，
 * 再按重复度与价值挑出真正值得展示的需求。
 */
const CLUSTER_PROMPT = [
  "你在做需求综述。输入是过去一小时从多个公开渠道采集到的候选条目（已脱敏），同一件事可能被不同人用不同措辞说了很多遍。",
  "",
  "任务分两步：",
  "第一步，只保留符合「作者本人说：我缺一个可复用的产品/工具/软件/服务」的条目；",
  "盘点/清单/排行榜、资讯与发布、自研自荐、教程/源码解析、报错与实现求助、学习资料、作业考试、招聘面经、情绪观点、软件具体操作提问，一律不算。",
  "第二步，把讲同一件事的条目合并成一组，按「重复条数」从多到少排列，挑出最有价值的需求。",
  "",
  "合并规则：",
  "- 同一工具品类 + 同一用途 = 同一组（例如「批量转微信 ID 的工具」「把 wxid 转成微信号的软件」属同一组）；",
  "- 只品类相同、用途不同（绘图 vs 建模）不要合并；",
  "- 一条候选只能归入一组，归入最先匹配的那组。",
  "",
  "每组输出：",
  "- canonicalTitle：规范化中文标题，≤30 字，说清「要什么工具、做什么用」，去掉营销词与 emoji；",
  "- memberIndexes：该组包含的输入 index 数组，必须来自输入；",
  "- score：0-100，综合重复度与需求清晰度的价值分；",
  "- reason：≤20 字，说明这批人在缺什么。",
  "",
  "只输出真正有意义的需求组；无意义、孤立且价值低的条目不要输出。",
  "输出严格 JSON：",
  '{"clusters":[{"canonicalTitle":"批量转换微信ID的工具","memberIndexes":[2,7,11],"score":88,"reason":"多人缺批量转wxid的软件"}]}',
].join("\n");

interface RawCluster {
  canonicalTitle?: unknown;
  memberIndexes?: unknown;
  score?: unknown;
  reason?: unknown;
}

interface ClusterPayload {
  clusters?: unknown;
}

export interface ParsedCluster {
  title: string;
  members: number[];
  score: number;
  reason: string;
}

/** 纯解析：模型输出 → 合法聚类（index 去重、越界丢弃、标题去空）。便于单测。 */
export function parseClusters(content: string, maxIndex: number): ParsedCluster[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const raw = (fenced?.[1] ?? content).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: ClusterPayload;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as ClusterPayload;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.clusters)) return [];

  const used = new Set<number>();
  const out: ParsedCluster[] = [];
  for (const item of parsed.clusters as RawCluster[]) {
    const title = String(item.canonicalTitle ?? "").trim();
    if (!title) continue;
    const members: number[] = [];
    if (Array.isArray(item.memberIndexes)) {
      for (const v of item.memberIndexes) {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n >= maxIndex) continue;
        if (used.has(n)) continue;
        used.add(n);
        members.push(n);
      }
    }
    if (members.length === 0) continue;
    const score = Number(item.score);
    out.push({
      title: title.slice(0, 120),
      members,
      score: Number.isFinite(score) ? Math.min(Math.max(score, 0), 100) : 0,
      reason: String(item.reason ?? "").trim().slice(0, 60),
    });
  }
  return out;
}

/** 规则兜底：无模型时按标题指纹/关键词相似度聚类，保证小时任务仍能产出。 */
export function clusterByRules(items: ClueItem[]): ParsedCluster[] {
  const groups: Array<{ title: string; members: number[]; keywords: string[] }> = [];
  items.forEach((item, index) => {
    const title = item.title.trim();
    const keywords = extractKeywords(title);
    const hit = groups.find((g) => isSamePain({ title, keywords }, { title: g.title, keywords: g.keywords }));
    if (hit) hit.members.push(index);
    else groups.push({ title, members: [index], keywords });
  });
  return groups
    .map((g) => ({
      title: g.title,
      members: g.members,
      score: g.members.length >= 2 ? 80 : 0,
      reason: "",
    }))
    .sort((a, b) => b.members.length - a.members.length);
}

/**
 * 小时聚合分析（F29 v0.8）：
 * - 取最近 CLUE_ANALYZE_INTERVAL_MIN 分钟（默认 60，对应 6 轮 10 分钟采集）内未被消费的候选；
 * - 交模型做跨条合并 + 价值排序，只保留有意义的需求组；
 * - 每组按规范化标题入库，组内各条成为同一条线索的提及 → 重复度自然体现在 mentionCount；
 * - 模型不可用时退回规则聚类，不阻断展示。
 */
export async function analyzeHourly(
  options: { force?: boolean; db?: typeof prisma } = {},
): Promise<HourlySummary> {
  const db = options.db ?? prisma;
  const now = new Date();
  const intervalMs = Math.max(Number(env.CLUE_ANALYZE_INTERVAL_MIN) || 60, 5) * 60_000;

  if (!options.force) {
    const state = await db.cronState.findUnique({ where: { key: "clue-hourly" } });
    if (state && now.getTime() - state.lastRunAt.getTime() < intervalMs) {
      return { ran: false, reason: "throttled", candidates: 0, clusters: 0, ranAt: now.toISOString() };
    }
  }

  // 顺带刷新一批模型检索词（每小时一次），失败不影响聚合
  let newQueries = 0;
  try {
    const { generateQueries } = await import("./llm-search");
    newQueries = await generateQueries(db, { count: 10 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[clue] 检索词生成失败：${message}`);
  }

  const maxItems = Math.max(Number(env.CLUE_ANALYZE_MAX_ITEMS) || 200, 10);
  // 取全部未消费候选（最旧的优先）：不再按「最近 1 小时」截断，避免某轮跳过后候选永久滞留在缓冲区
  // （滞留下来的候选同时会被采集端的去重挡住，等于永久漏采）。超出 maxItems 的留给下一次聚合继续消费。
  const rows = await db.clueCandidate.findMany({
    where: { usedAt: null },
    orderBy: { fetchedAt: "asc" },
    take: maxItems,
  });
  const pendingTotal = await db.clueCandidate.count({ where: { usedAt: null } });

  const markState = async () =>
    db.cronState.upsert({
      where: { key: "clue-hourly" },
      update: { lastRunAt: now },
      create: { key: "clue-hourly", lastRunAt: now },
    });

  if (rows.length === 0) {
    await markState();
    return {
      ran: true,
      reason: "no-candidates",
      candidates: 0,
      clusters: 0,
      newQueries,
      ranAt: now.toISOString(),
    };
  }

  const items: ClueItem[] = rows.map((row) => ({
    sourceKey: row.sourceKey,
    externalId: row.externalId,
    title: row.title,
    excerpt: row.excerpt,
    url: row.url,
    authorId: row.authorKey,
    mentionedAt: row.mentionedAt,
  }));

  let clusters: ParsedCluster[];
  let provider: string | undefined;
  if (isClueLlmEnabled()) {
    try {
      const res = await clusterViaLlm(items, Math.round(intervalMs / 60_000));
      clusters = res.clusters;
      provider = res.provider;
      if (clusters.length === 0) {
        console.warn("[clue] 小时聚合模型未返回有效分组，退回规则聚类");
        clusters = clusterByRules(items);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[clue] 小时聚合模型调用失败，退回规则聚类：${message}`);
      clusters = clusterByRules(items);
    }
  } else {
    clusters = clusterByRules(items);
  }

  // 价值门槛：多条重复组直接保留；单条组要求模型给到较高价值分
  const accepted = clusters.filter((c) => c.members.length >= 2 || c.score >= 80);
  if (accepted.length === 0) {
    await markUsed(db, rows.map((r) => r.id), now);
    await markState();
    return {
      ran: true,
      reason: "no-clusters",
      candidates: rows.length,
      clusters: 0,
      newQueries,
      ranAt: now.toISOString(),
    };
  }

  const service = new ClueService(db);
  const summary: IngestSummary = { fetched: 0, created: 0, merged: 0, skipped: 0 };
  for (const cluster of accepted) {
    const members = cluster.members.map((i) => items[i]).filter((v): v is ClueItem => Boolean(v));
    // 组内统一用规范化标题 → ingest 的标题指纹/关键词聚合会把它们并成同一条线索
    const batch: ClueItem[] = members.map((item) => ({ ...item, title: cluster.title }));
    const r = await service.ingest(batch, { requireDemandSignal: false });
    if (r.ok) {
      summary.fetched += r.value.fetched;
      summary.created += r.value.created;
      summary.merged += r.value.merged;
      summary.skipped += r.value.skipped;
    }
  }

  await markUsed(db, rows.map((r) => r.id), now);
  await markState();

  const avgRepeat =
    accepted.length > 0 ? accepted.reduce((sum, c) => sum + c.members.length, 0) / accepted.length : 0;

  return {
    ran: true,
    candidates: rows.length,
    clusters: accepted.length,
    avgRepeat: Math.round(avgRepeat * 10) / 10,
    ingest: summary,
    provider,
    newQueries,
    ranAt: now.toISOString(),
  };
}

async function markUsed(db: typeof prisma, ids: string[], at: Date): Promise<void> {
  if (ids.length === 0) return;
  await db.clueCandidate.updateMany({ where: { id: { in: ids } }, data: { usedAt: at } });
}

/** 每批送模型的候选条数：主模型是 reasoning 模型，批量越大越容易把输出预算耗在思维链上（表现为 content 为空、退回备用模型） */
const LLM_CHUNK = 15;

/**
 * 分批交模型聚类，再按规范化标题合并各批结果。
 * 单批失败只影响该批（该批候选不参与本次聚类，留待下次），不影响其他批。
 */
async function clusterViaLlm(
  items: ClueItem[],
  windowMinutes: number,
): Promise<{ clusters: ParsedCluster[]; provider?: string }> {
  const merged = new Map<string, ParsedCluster>();
  let provider: string | undefined;
  let batchOk = 0;
  for (let start = 0; start < items.length; start += LLM_CHUNK) {
    const slice = items.slice(start, start + LLM_CHUNK);
    try {
      const res = await callLlm(
        CLUSTER_PROMPT,
        JSON.stringify({
          windowMinutes,
          items: slice.map((item, index) => ({
            index,
            title: item.title.slice(0, 120),
            excerpt: (item.excerpt ?? "").slice(0, 200),
          })),
        }),
        120_000,
      );
      provider = provider ?? res.provider;
      batchOk++;
      for (const cluster of parseClusters(res.content, slice.length)) {
        const key = cluster.title.replace(/\s+/g, "");
        const prev = merged.get(key);
        if (prev) {
          prev.members.push(...cluster.members.map((i) => i + start));
          prev.score = Math.max(prev.score, cluster.score);
        } else {
          merged.set(key, { ...cluster, members: cluster.members.map((i) => i + start) });
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[clue] 聚合批次 ${start}-${start + slice.length} 失败：${message}`);
    }
  }
  // 全部批次都失败时抛出，让外层退回规则聚类
  if (batchOk === 0 && items.length > 0) {
    throw new Error("小时聚合全部批次失败");
  }
  return { clusters: [...merged.values()].sort((a, b) => b.members.length - a.members.length), provider };
}
