import { getSession } from "@/lib/auth";
import { err, DomainError, ok } from "@/domain/shared/result";
import { toResponse } from "@/lib/api-response";
import { prisma } from "@/infrastructure/prisma/client";

export async function GET() {
  const session = await getSession();
  if (!session) return toResponse(err("未登录", DomainError.UNAUTHORIZED));
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, phone: true, nickname: true, roles: true, kycStatus: true, reputationScore: true },
  });
  if (!user) return toResponse(err("用户不存在", DomainError.NOT_FOUND));
  return toResponse(ok(user));
}
