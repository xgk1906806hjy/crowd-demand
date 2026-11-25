import { env } from "@/lib/env";
import type { ClueItem } from "@/infrastructure/clue/types";
import { isPromotionalTitle, looksLikeDemand, sanitizeExcerpt } from "./keywords";

/**
 * 单批条数（v0.7）。
 * 主模型 sensenova-6.8-flash-lite 是 reasoning 模型，单条会先产出上千 token 思维链；
 * 40 条/批会耗尽输出 token 导致 content 为空、整批降级放行噪声（实测 KeyError/空响应），
 * 因此压到 10 条/批。
 */
const MAX_BATCH = 10;
/** 单轮最多处理条数，防止一轮候选过多时无限消耗。 */
const MAX_TOTAL = 600;
/** 并发批次数，兼顾总时长与接口限流。 */
const MAX_CONCURRENT = 4;
/** 判定置信分下限：低于该分视为「拿不准」，按非需求处理。 */
const MIN_SCORE = 75;

export interface RefineResult {
  items: ClueItem[];
  /** 被模型判定为非需求而剔除的条数 */
  dropped: number;
  /** 是否真正调用了模型并生效（未配置/失败为 false，此时原样返回） */
  applied: boolean;
  /** 实际生效的模型标识（主模型或备用模型） */
  provider?: string;
}

interface LlmProvider {
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  wire: "chat" | "responses";
}

/** 主模型 + 备用模型，顺序即回退顺序。任一组三项齐备即启用。 */
export function listClueLlmProviders(): LlmProvider[] {
  const options: LlmProvider[] = [
    {
      label: "primary",
      baseUrl: env.LLM_BASE_URL ?? "",
      apiKey: env.LLM_API_KEY ?? "",
      model: env.LLM_MODEL ?? "",
      wire: env.LLM_WIRE_API === "responses" ? "responses" : "chat",
    },
    {
      label: "fallback",
      baseUrl: env.LLM_FALLBACK_BASE_URL ?? "",
      apiKey: env.LLM_FALLBACK_API_KEY ?? "",
      model: env.LLM_FALLBACK_MODEL ?? "",
      wire: env.LLM_FALLBACK_WIRE_API === "responses" ? "responses" : "chat",
    },
  ];
  return options.filter((p) => p.baseUrl && p.apiKey && p.model);
}

/** 大模型整合是否启用：主模型或备用模型任一组三项齐备。 */
export function isClueLlmEnabled(): boolean {
  return listClueLlmProviders().length > 0;
}

interface LlmVerdict {
  index?: number;
  isDemand?: boolean;
  title?: string;
  /** 0-100 判定置信分（v0.7） */
  score?: number;
  /** 判为需求时的自证说明：缺什么、用来干什么（v0.7） */
  reason?: string;
}

/**
 * 判定提示词（v0.7）。
 * 相比 v0.6 的三处强化：
 * 1. 先跑「非需求黑名单」，命中即否，避免模型被「求/推荐」字眼带偏；
 * 2. 判为需求必须给 reason 自证（缺什么、做什么用），说不出理由就等于不是需求；
 * 3. 输出 score，供本地做阈值兜底，把拿不准的样本挡在榜单外。
 */
const SYSTEM_PROMPT = [
  "你是需求线索审核员。输入是一批来自技术社区/问答区/论坛的候选条目（已脱敏）。",
  "",
  "对每一条，判断「作者本人是否在说：我缺一个可复用的产品/工具/软件/服务」。",
  "",
  "判 YES 必须同时满足三条：",
  "1) 是作者自己的诉求，不是转述、报道、评测别人；",
  "2) 缺的是一个可复用的东西（工具/软件/服务/功能方案），不是一次性代码帮助或信息；",
  "3) 能说清「拿它做什么」。",
  "",
  "出现下列任一情况一律判 NO（即使标题含「求」「求助」「推荐」「有没有」「痛点」）：",
  "- 盘点/清单/合集/排行榜/年度总结（XX 工具 Top10、必备软件清单、亲测六款、好用工具合集）；",
  "- 资讯与发布（产品上线、融资、获奖、征文、名单公示、大会预告）；",
  "- 作者在介绍/推广自己做的产品或项目（新鲜出炉、自研、我做了个、开源了一个、上线了）；",
  "- 教程/攻略/原理讲解/源码解析/避坑指南/学习方法；",
  "- 报错、异常、堆栈、环境配置、代码实现、算法题、debug；",
  "- 找学习资料（书、课程、视频、题解、认证、论文）；",
  "- 学生作业、考试题、课设、毕设、代做代写；",
  "- 招聘、内推、简历、面经；",
  "- 个人情绪、生活琐事、与产品无关的观点争论；",
  "- 只问某个软件「怎么用」的具体操作问题。",
  "",
  "判定顺序：先查 NO 黑名单，命中即 NO；未命中再核对 YES 三条，缺一条即 NO；拿不准判 NO。",
  "",
  "例外（避免误杀）：标题本身已是「求推荐/有没有/想找 + 具体工具品类」（App、软件、SDK、插件、引擎、框架、工具、服务），",
  "品类明确且不属于书/课程/资料/作业/招聘时，即使没写使用场景也判 YES，reason 写「缺XX类工具」。",
  "",
  "判 YES 时必须写 reason（不超过 20 字，说明缺的是什么、用来干什么）。写不出 reason 说明它不是需求，改判 NO。",
  "score 为 0-100 的置信分：证据充分 85-100，基本确定 75-84，有疑问则低于 75。",
  "",
  "参考示例：",
  "- 「求Wxid转微信号批量转换工具」→ YES，score 92，reason「缺批量转微信ID的工具」，title「求批量转换微信ID的工具」",
  "- 「有没有免费的 Web 端 PDF 编辑 JS 库」→ YES，score 88，reason「缺免费Web PDF编辑库」",
  "- 「MAC 软件推荐，日常工作办公实用软件」→ NO（推介清单）",
  "- 「收藏！这份必备免费软件清单」→ NO（清单）",
  "- 「TRAE Work 实战帮征文 | 获奖名单公示」→ NO（活动公示）",
  "- 「求大家推荐一本linux书」→ NO（学习资料）",
  "",
  "判 YES 时给出规范化中文标题：一律简体中文（英文请翻译），不超过 30 字，去掉营销词、广告词、emoji 与标题党修饰，保留具体场景与对象。",
  "",
  "必须覆盖输入中的每一个 index，一条不漏：判 NO 的也要输出 {\"index\":n,\"isDemand\":false}，不要省略、不要合并。",
  "输出严格 JSON，不要代码块以外的解释：",
  '{"items":[{"index":0,"isDemand":true,"score":92,"reason":"缺XX工具，用于YY","title":"中文标题≤30字"},{"index":1,"isDemand":false}]}',
  "isDemand=false 的条目只给 index 与 isDemand，不要 title/reason/score。",
].join("\n");

function parseVerdicts(content: string): LlmVerdict[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  const raw = (fenced?.[1] ?? content).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型输出不是 JSON");
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { items?: LlmVerdict[] };
  return Array.isArray(parsed.items) ? parsed.items : [];
}

/**
 * 从两种协议响应中取文本：
 * - chat：choices[0].message.content
 * - responses：顶层 output_text，或 output[].content[].text
 */
function extractText(data: unknown, wire: "chat" | "responses"): string {
  if (wire === "responses") {
    const payload = data as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };
    if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
      return payload.output_text;
    }
    const parts = (payload?.output ?? [])
      .flatMap((item) => item?.content ?? [])
      .map((c) => c?.text ?? "")
      .join("");
    if (!parts.trim()) throw new Error("responses 响应缺少文本");
    return parts;
  }
  const payload = data as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("模型响应缺少内容");
  return content;
}

/**
 * 采集后、入库前的可选大模型整合（F29 v0.4）。
 * - 未配置 LLM_* 时直接返回原数据，保持原有规则聚合；
 * - 任何失败（超时/鉴权/格式错误）都降级为原数据，不影响采集主链路；
 * - 发往模型的只有脱敏后的标题与摘要，不传作者与 URL。
 */
export async function refineClues(
  items: ClueItem[],
  opts: { timeoutMs?: number } = {},
): Promise<RefineResult> {
  const passthrough: RefineResult = { items, dropped: 0, applied: false };
  if (!isClueLlmEnabled() || items.length === 0) return passthrough;

  const kept: ClueItem[] = [];
  let dropped = 0;
  let applied = false;
  const limit = Math.min(items.length, MAX_TOTAL);
  if (items.length > limit) {
    // 超出单轮上限的候选直接放弃，不能绕过模型判定直接入库，否则会把教程/广告混进榜单
    console.warn(`[clue] 候选 ${items.length} 条超出单轮上限 ${MAX_TOTAL}，剩余 ${items.length - limit} 条留待后续轮次`);
  }

  // 分批并发（限 4 路）：串行处理会让总耗时随批数线性增长，超过调用方的等待上限。
  const batches: ClueItem[][] = [];
  for (let offset = 0; offset < limit; offset += MAX_BATCH) {
    batches.push(items.slice(offset, offset + MAX_BATCH));
  }
  const results: Array<{ kept: ClueItem[]; dropped: number; provider?: string } | null> = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < batches.length) {
      const index = cursor++;
      results[index] = await refineBatch(batches[index] ?? [], opts.timeoutMs);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT, batches.length) }, () => worker()),
  );
  let provider: string | undefined;
  results.forEach((result, i) => {
    const batch = batches[i] ?? [];
    if (!result) {
      // 理论上不再出现：refineBatch 失败已改为规则兜底返回
      kept.push(...batch);
      return;
    }
    // applied 表示「模型判定真正生效」；该批走了规则兜底时没有 provider，不算生效
    applied = applied || Boolean(result.provider);
    provider = provider ?? result.provider;
    dropped += result.dropped;
    kept.push(...result.kept);
  });

  return { items: kept, dropped, applied, provider };
}

/** 是否含中文汉字；用于判断标题是否已本地化。 */
const CJK_RE = /[\u4e00-\u9fff]/;

const TRANSLATE_PROMPT = [
  "把下面这些产品需求标题翻译并压缩成简体中文标题。",
  "要求：每条不超过 30 字，保留具体对象与使用场景，不要加营销词。",
  '只输出 JSON：{"items":[{"index":0,"title":"……"}]}',
].join("\n");

/** 对外的通用调用入口：小时聚合、检索词生成等场景复用同一套主备与协议适配。 */
export async function callLlm(
  systemPrompt: string,
  userContent: string,
  timeoutMs?: number,
): Promise<{ content: string; provider: string }> {
  return callModel(systemPrompt, userContent, timeoutMs);
}

/** 调用模型并返回文本；两种协议（chat / responses）在此统一。 */
async function callModel(
  systemPrompt: string,
  userContent: string,
  timeoutMs?: number,
): Promise<{ content: string; provider: string }> {
  const providers = listClueLlmProviders();
  if (providers.length === 0) throw new Error("未配置大模型");

  let lastError: Error | null = null;
  for (const provider of providers) {
    try {
      const content = await requestProvider(provider, systemPrompt, userContent, timeoutMs);
      return { content, provider: `${provider.label}:${provider.model}` };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`[clue] 模型 ${provider.label}:${provider.model} 调用失败，尝试下一个：${lastError.message}`);
    }
  }
  throw lastError ?? new Error("大模型调用失败");
}

/** 向单个供应商发起一次请求（chat / responses 双协议）。 */
async function requestProvider(
  provider: LlmProvider,
  systemPrompt: string,
  userContent: string,
  timeoutMs?: number,
): Promise<string> {
  const base = provider.baseUrl.replace(/\/+$/, "");
  const endpoint =
    provider.wire === "responses" ? `${base}/responses` : `${base}/chat/completions`;
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
  const body =
    provider.wire === "responses"
      ? { model: provider.model, input: messages }
      : {
          model: provider.model,
          temperature: 0,
          // reasoning 模型会先花上千 token 思考，留足输出预算，避免 content 为空
          max_tokens: 4000,
          response_format: { type: "json_object" },
          messages,
        };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs ?? 120_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${provider.label} 模型接口 ${res.status}`);

  const data: unknown = await res.json();
  return extractText(data, provider.wire);
}

/** 处理单批；失败返回 null 由调用方降级。 */
async function refineBatch(
  batch: ClueItem[],
  timeoutMs?: number,
): Promise<{ kept: ClueItem[]; dropped: number; provider?: string } | null> {
  const payload = batch.map((item, index) => ({
    index,
    title: item.title.slice(0, 120),
    excerpt: sanitizeExcerpt(item.excerpt ?? ""),
  }));

  try {
    const { content, provider } = await callModel(
      SYSTEM_PROMPT,
      JSON.stringify({ items: payload }),
      timeoutMs,
    );

    const verdicts = parseVerdicts(content);
    const byIndex = new Map<number, LlmVerdict>();
    for (const v of verdicts) {
      if (typeof v.index === "number") byIndex.set(v.index, v);
    }

    const kept: ClueItem[] = [];
    let dropped = 0;
    batch.forEach((item, index) => {
      const verdict = byIndex.get(index);
      // 模型没有给出该条判定：不无脑放行（会把教程/广告混进榜单），也不无脑丢弃，
      // 改走规则兜底——有需求句式且不是推介标题才保留。
      if (!verdict) {
        if (looksLikeDemand(item.title) && !isPromotionalTitle(item.title)) {
          kept.push(item);
        } else {
          dropped++;
        }
        return;
      }
      if (verdict.isDemand === false) {
        dropped++;
        return;
      }
      // 置信分兜底：拿不准的一律按非需求处理（v0.7 质量优先）
      const score = typeof verdict.score === "number" ? verdict.score : 0;
      if (score < MIN_SCORE) {
        dropped++;
        return;
      }
      // 必须自证：说不出「缺什么、做什么用」的，说明模型是猜的
      if (!(verdict.reason ?? "").trim()) {
        dropped++;
        return;
      }
      const title = (verdict.title ?? "").trim().slice(0, 120);
      kept.push(title ? { ...item, title } : item);
    });

    // 英文原文标题补一次翻译，保证中文站热榜可读
    await localizeTitles(kept, timeoutMs);
    // 标题归一后再兜一层：盘点/亲测/教程类标题按推介文剔除（轻量模型常漏判）
    for (let i = kept.length - 1; i >= 0; i--) {
      const item = kept[i];
      if (item && isPromotionalTitle(item.title)) {
        kept.splice(i, 1);
        dropped++;
      }
    }
    return { kept, dropped, provider };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[clue] 大模型整合失败，该批降级规则判定：${message}`);
    // 降级不再整批放行：只保留有需求句式、且不是推介/盘点标题的条目，避免模型故障时噪声灌进榜单
    const fallback = batch.filter(
      (item) => looksLikeDemand(`${item.title} ${item.excerpt ?? ""}`) && !isPromotionalTitle(item.title),
    );
    return { kept: fallback, dropped: batch.length - fallback.length };
  }
}

/** 对不含中文的标题做一次批量翻译；失败时保留原文，不影响整批结果。 */
async function localizeTitles(items: ClueItem[], timeoutMs?: number): Promise<void> {
  const targets: number[] = [];
  items.forEach((item, i) => {
    if (!CJK_RE.test(item.title)) targets.push(i);
  });
  if (targets.length === 0) return;

  try {
    const payload = targets.map((i, n) => ({
      index: n,
      title: (items[i]?.title ?? "").slice(0, 120),
    }));
    const { content } = await callModel(
      TRANSLATE_PROMPT,
      JSON.stringify({ items: payload }),
      timeoutMs,
    );
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
    const raw = (fenced?.[1] ?? content).trim();
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { items?: LlmVerdict[] };
    for (const v of parsed.items ?? []) {
      if (typeof v.index !== "number") continue;
      const title = (v.title ?? "").trim().slice(0, 120);
      if (!title || !CJK_RE.test(title)) continue;
      const target = targets[v.index];
      if (typeof target !== "number") continue;
      const original = items[target];
      if (original) items[target] = { ...original, title };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[clue] 标题翻译失败，保留原文：${message}`);
  }
}
