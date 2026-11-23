import { UserRole } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { LedgerQueryService } from "@/domain/ledger/query";

export const dynamic = "force-dynamic";

/** GET /api/admin/ledger —— 托管余额与资金流水（F19）。 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));
  if (!user.roles.includes(UserRole.OPERATOR)) {
    return toResponse(err("仅运营方可查看资金流水", DomainError.FORBIDDEN));
  }
  return toResponse(await new LedgerQueryService().overview());
}
