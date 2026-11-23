import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { toResponse } from "@/lib/api-response";
import { err, ok, DomainError } from "@/domain/shared/result";
import { expireOverdueNeeds } from "@/domain/pledge/lifecycle";

export const dynamic = "force-dynamic";

/**
 * POST /api/internal/cron —— 定时任务入口（F11）。
 *
 * 由部署侧的 cron 容器携带 `x-cron-secret` 定期调用，执行到期承诺的流拍与全额退款。
 * 未配置 CRON_SECRET 或密钥不匹配时一律拒绝，避免被公开触发。
 * 幂等：同一需求第二次执行时已处于 FAILED/REFUNDED，不会重复退款。
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

  const summary = await expireOverdueNeeds();
  return toResponse(ok({ ...summary, ranAt: new Date().toISOString() }));
}
