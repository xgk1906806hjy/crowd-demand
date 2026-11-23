import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { MilestoneService } from "@/domain/milestone/service";

export const dynamic = "force-dynamic";

/** POST /api/milestones/[id]/accept —— 验收并放款（F15/F16/F17）。 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));

  const { id } = await ctx.params;
  return toResponse(await new MilestoneService().accept(session.userId, id));
}
