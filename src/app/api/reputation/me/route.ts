import { getSession } from "@/lib/auth";
import { ReputationService } from "@/domain/reputation/service";
import { err, ok, DomainError } from "@/domain/shared/result";
import { toResponse } from "@/lib/api-response";

export async function GET() {
  const session = await getSession();
  if (!session) return toResponse(err("未登录", DomainError.UNAUTHORIZED));

  const service = new ReputationService();
  return toResponse(ok(await service.refresh(session.userId)));
}
