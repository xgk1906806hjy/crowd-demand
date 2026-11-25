import { prisma } from "@/infrastructure/prisma/client";
import { callLlm, isClueLlmEnabled } from "./enrich";

/**
 * 模型生成检索词（F29 v0.8「用大模型搜索」的第一条腿）。
 *
 * 固定检索词（"求推荐一款软件"这类）长期不变会搜到同一批老帖，命中率随时间衰减；
 * 这里每小时让模型基于最近采到的标题，产出一批更贴近当下说法的新检索词，
 * 采集轮次再把它们与固定词混用。
 */
const QUERY_PROMPT = [
  "你在为「公开渠道需求采集」设计站内检索词。",
  "目标是搜到「作者本人在说：我缺一个可复用的产品/工具/软件/服务」的帖子。",
  "",
  "参考最近的候选标题（只作语感参考，不要照抄）：",
  "{samples}",
  "",
  "要求：",
  "1) 输出 {count} 条中文检索词，每条 4-12 个字，是搜索框里会输入的自然短语；",
  "2) 覆盖不同场景与表达方式（求推荐类、找替代类、定制开发类、工具缺失类），不要都在同一句式；",
  "3) 不要带引号、标点、平台名、年份；不要写成完整句子；",
  "4) 不要包含「盘点」「教程」「排行」这类会搜到推介文的词。",
  "",
  '只输出 JSON：{"queries":["…","…"]}',
].join("\n");

interface QueryPayload {
  queries?: unknown;
}

/** 纯解析：模型输出 → 去重、限长、限量的检索词数组（便于单测）。 */
export function parseQueryList(content: string, limit = 10): string[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const raw = (fenced?.[1] ?? content).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let parsed: QueryPayload;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as QueryPayload;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.queries)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of parsed.queries) {
    const q = String(value ?? "")
      .replace(/[「」"'“”《》？?！!，,。.]/g, "")
      .trim();
    if (!q || q.length < 4 || q.length > 20) continue;
    if (/盘点|教程|排行榜|榜单|合集/.test(q)) continue;
    if (seen.has(q)) continue;
    seen.add(q);
    out.push(q);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 生成一批检索词并入库；返回实际新增条数。
 * 无模型配置、模型失败或输出不合法时返回 0，采集侧继续用固定词，不阻断采集。
 */
export async function generateQueries(
  db: typeof prisma,
  opts: { count?: number; timeoutMs?: number } = {},
): Promise<number> {
  if (!isClueLlmEnabled()) return 0;
  const count = opts.count ?? 10;

  const recent = await db.demandClue.findMany({
    orderBy: { lastSeenAt: "desc" },
    take: 60,
    select: { title: true },
  });
  const samples = recent.map((r) => `- ${r.title}`).join("\n") || "- （暂无）";

  let content: string;
  try {
    const res = await callLlm(
      QUERY_PROMPT.replace("{samples}", samples).replace("{count}", String(count)),
      JSON.stringify({ task: "generate-queries", count }),
      opts.timeoutMs,
    );
    content = res.content;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[clue] 检索词生成失败，继续使用固定词：${message}`);
    return 0;
  }

  const queries = parseQueryList(content, count);
  if (queries.length === 0) return 0;

  const existing = await db.clueQuery.findMany({ select: { query: true } });
  const known = new Set(existing.map((r) => r.query));
  const fresh = queries.filter((q) => !known.has(q));
  if (fresh.length === 0) return 0;

  await db.clueQuery.createMany({
    data: fresh.map((q) => ({ query: q, origin: "llm" })),
    skipDuplicates: true,
  });
  return fresh.length;
}

/** 取当前可用的模型检索词（最近 24 小时），供采集轮次混用。 */
export async function listActiveQueries(db: typeof prisma, limit = 8): Promise<string[]> {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const rows = await db.clueQuery.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { query: true },
  });
  return rows.map((r) => r.query);
}
