import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { MilestoneService } from "@/domain/milestone/service";

export const dynamic = "force-dynamic";

/** POST /api/milestones/[id]/submit —— 提交节点交付物（F14）。 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));

  const { id } = await ctx.params;

  let note = "";
  try {
    const body = (await req.json()) as { note?: unknown };
    if (typeof body.note === "string") note = body.note;
  } catch {
    // 允许空请求体
  }

  return toResponse(await new MilestoneService().submit(session.userId, id, note));
}
