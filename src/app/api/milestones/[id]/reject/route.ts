import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { MilestoneService } from "@/domain/milestone/service";

export const dynamic = "force-dynamic";

/** POST /api/milestones/[id]/reject —— 验收不通过（F15）。 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));

  const { id } = await ctx.params;

  let reason = "";
  try {
    const body = (await req.json()) as { reason?: unknown };
    if (typeof body.reason === "string") reason = body.reason;
  } catch {
    return toResponse(err("请填写驳回原因", DomainError.VALIDATION));
  }

  return toResponse(await new MilestoneService().reject(session.userId, id, reason));
}
