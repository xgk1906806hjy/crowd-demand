import { NextRequest } from "next/server";
import { NeedStatus } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { NeedService } from "@/domain/need/service";

export const dynamic = "force-dynamic";

/** POST /api/needs/[id]/status —— 状态流转（F06）。 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));

  const { id } = await ctx.params;

  let body: { to?: unknown; reason?: unknown };
  try {
    body = (await req.json()) as { to?: unknown; reason?: unknown };
  } catch {
    return toResponse(err("请求体格式不正确", DomainError.VALIDATION));
  }

  if (typeof body.to !== "string" || !(body.to in NeedStatus)) {
    return toResponse(err("目标状态不合法", DomainError.VALIDATION));
  }

  const service = new NeedService();
  const result = await service.transition(
    session.userId,
    id,
    body.to as NeedStatus,
    typeof body.reason === "string" ? body.reason : undefined,
  );

  return toResponse(result);
}
