import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { ProposalService } from "@/domain/proposal/service";

export const dynamic = "force-dynamic";

/** POST /api/needs/[id]/select-proposal —— 发起者选标（F13）。 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));

  const { id } = await ctx.params;

  let body: { proposalId?: unknown };
  try {
    body = (await req.json()) as { proposalId?: unknown };
  } catch {
    return toResponse(err("请求体格式不正确", DomainError.VALIDATION));
  }

  if (typeof body.proposalId !== "string" || !body.proposalId) {
    return toResponse(err("缺少提案编号", DomainError.VALIDATION));
  }

  return toResponse(await new ProposalService().select(session.userId, id, body.proposalId));
}
