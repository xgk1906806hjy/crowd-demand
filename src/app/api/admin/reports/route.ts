import { UserRole } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, ok, DomainError } from "@/domain/shared/result";
import { ReportService } from "@/domain/report/service";

export const dynamic = "force-dynamic";

/** GET /api/admin/reports —— 待处理举报（F20）。 */
export async function GET() {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));
  if (!session.roles.includes(UserRole.OPERATOR)) {
    return toResponse(err("仅运营方可查看举报", DomainError.FORBIDDEN));
  }

  const items = await new ReportService().listPending();
  return toResponse(ok({ items }));
}
