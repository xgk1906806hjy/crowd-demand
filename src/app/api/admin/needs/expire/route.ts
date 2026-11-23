import { UserRole } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, ok, DomainError } from "@/domain/shared/result";
import { expireOverdueNeeds } from "@/domain/pledge/lifecycle";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/needs/expire —— 手动触发到期结算（F11）。
 * 生产环境应由 BullMQ 定时任务调用，接口仅作为运营兜底手段。
 */
export async function POST() {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));
  if (!session.roles.includes(UserRole.OPERATOR)) {
    return toResponse(err("仅运营方可执行到期结算", DomainError.FORBIDDEN));
  }

  const summary = await expireOverdueNeeds();
  return toResponse(ok(summary));
}
