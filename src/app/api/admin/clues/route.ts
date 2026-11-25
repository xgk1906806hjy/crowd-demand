import { UserRole } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, ok, DomainError } from "@/domain/shared/result";
import { ClueService } from "@/domain/clue/service";

export const dynamic = "force-dynamic";

/** GET /api/admin/clues —— 运营查看全部线索与来源（F29）。 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));
  if (!user.roles.includes(UserRole.OPERATOR)) {
    return toResponse(err("仅运营方可查看线索", DomainError.FORBIDDEN));
  }
  const service = new ClueService();
  const [items, sources] = await Promise.all([service.listForAdmin(), service.listSources()]);
  return toResponse(ok({ items, sources }));
}
