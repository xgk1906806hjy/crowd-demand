import { getSession } from "@/lib/auth";
import { KycService } from "@/domain/kyc/service";
import { createKycGateway } from "@/infrastructure/kyc/gateway";
import { err, DomainError } from "@/domain/shared/result";
import { toResponse } from "@/lib/api-response";

export async function GET() {
  const session = await getSession();
  if (!session) return toResponse(err("未登录", DomainError.UNAUTHORIZED));

  const service = new KycService(createKycGateway());
  return toResponse(await service.status(session.userId));
}
