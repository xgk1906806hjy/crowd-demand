import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { PledgeService } from "@/domain/pledge/service";

export const dynamic = "force-dynamic";

/** GET /api/pledges/mine —— 我的承诺列表（F09）。 */
export async function GET() {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));
  const service = new PledgeService();
  return toResponse(await service.listMine(session.userId));
}
