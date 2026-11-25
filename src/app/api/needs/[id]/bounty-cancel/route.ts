import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { BountyService } from "@/domain/bounty/service";

export const dynamic = "force-dynamic";

/** POST /api/needs/[id]/bounty-cancel —— 撤回悬赏，托管剩余全额退回需求方（F28）。 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));

  const { id } = await ctx.params;

  let reason: string | undefined;
  try {
    const body = (await req.json()) as { reason?: unknown };
    reason = typeof body.reason === "string" ? body.reason : undefined;
  } catch {
    // 允许空 body
  }

  return toResponse(await new BountyService().cancelAndRefund(session.userId, id, reason));
}
