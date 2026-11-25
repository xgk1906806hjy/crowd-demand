import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { toResponse } from "@/lib/api-response";
import { err, ok, DomainError } from "@/domain/shared/result";
import { expireOverdueNeeds } from "@/domain/pledge/lifecycle";
import { collectClues } from "@/domain/clue/collect";
import { analyzeHourly } from "@/domain/clue/analyze";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/cron —— 定时任务入口（F11 + F29）。
 *
 * 由部署侧的 cron 容器携带 `x-cron-secret` 定期调用：
 * - expire：到期承诺的流拍与全额退款（每次执行，幂等）；
 * - clues：外部渠道需求采集，写入候选缓冲区（按 CLUE_INGEST_INTERVAL_MIN 节流，v0.8 默认 10 分钟）；
 * - clue-hourly：把最近一小时（约 6 轮）候选合并交模型聚类，提取重复度最高且有意义的需求后入库
 *   （按 CLUE_ANALYZE_INTERVAL_MIN 节流，默认 60 分钟）；
 * - all：三者依次执行（expire 每次、clues 与 clue-hourly 各自按间隔节流）。
 * 可选 JSON body：{ "job": "expire" | "clues" | "clue-hourly" | "all", "force": true }；
 * force 跳过节流，供联调/冒烟使用。
 * 未配置 CRON_SECRET 或密钥不匹配时一律拒绝，避免被公开触发。
 */
export async function POST(req: NextRequest) {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return toResponse(err("未配置 CRON_SECRET，定时任务已禁用", DomainError.SERVICE_UNAVAILABLE));
  }

  const provided = req.headers.get("x-cron-secret");
  if (!provided || provided !== secret) {
    return toResponse(err("定时任务密钥无效", DomainError.UNAUTHORIZED));
  }

  let job = "all";
  let force = false;
  try {
    const body = (await req.json()) as { job?: unknown; force?: unknown };
    if (body.job === "expire" || body.job === "clues" || body.job === "clue-hourly" || body.job === "all") {
      job = body.job;
    }
    if (body.force === true) force = true;
  } catch {
    // 无 body / 非 JSON：按默认 all 执行（兼容既有 cron 容器调用）
  }

  const out: Record<string, unknown> = { ranAt: new Date().toISOString() };
  if (job === "all" || job === "expire") {
    out.expire = await expireOverdueNeeds();
  }
  if (job === "all" || job === "clues") {
    out.clues = await collectClues({ force });
  }
  if (job === "all" || job === "clue-hourly") {
    out.hourly = await analyzeHourly({ force });
  }
  return toResponse(ok(out));
}
