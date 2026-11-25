import { NextRequest } from "next/server";
import { UserRole } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { ClueService } from "@/domain/clue/service";

export const dynamic = "force-dynamic";

/** POST /api/admin/clues/[id]/review —— 线索收录/丢弃（F29）。 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));
  if (!user.roles.includes(UserRole.OPERATOR)) {
    return toResponse(err("仅运营方可审核线索", DomainError.FORBIDDEN));
  }

  const { id } = await ctx.params;
  let body: { action?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return toResponse(err("请求体格式不正确", DomainError.VALIDATION));
  }
  if (body.action !== "FEATURE" && body.action !== "DISCARD") {
    return toResponse(err("action 仅支持 FEATURE / DISCARD", DomainError.VALIDATION));
  }

  return toResponse(await new ClueService().review(user.userId, id, body.action));
}
