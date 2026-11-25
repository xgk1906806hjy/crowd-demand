import { UserRole } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, ok, DomainError } from "@/domain/shared/result";
import { collectClues } from "@/domain/clue/collect";

export const dynamic = "force-dynamic";

/** POST /api/admin/clues/collect —— 运营手动触发一次采集（跳过节流，F29）。 */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));
  if (!user.roles.includes(UserRole.OPERATOR)) {
    return toResponse(err("仅运营方可触发采集", DomainError.FORBIDDEN));
  }
  const summary = await collectClues({ force: true });
  return toResponse(ok(summary));
}
