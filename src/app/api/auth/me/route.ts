import { getSession } from "@/lib/auth";
import { err, DomainError, ok } from "@/domain/shared/result";
import { toResponse } from "@/lib/api-response";
import { prisma } from "@/infrastructure/prisma/client";

export async function GET() {
  const session = await getSession();
  if (!session) return toResponse(err("未登录", DomainError.UNAUTHORIZED));
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      phone: true,
      email: true,
      username: true,
      nickname: true,
      roles: true,
      kycStatus: true,
      reputationScore: true,
      passwordHash: true,
    },
  });
  if (!user) return toResponse(err("用户不存在", DomainError.NOT_FOUND));
  // 绝不返回密码哈希，只暴露"是否已设置"
  const { passwordHash, ...safe } = user;
  return toResponse(ok({ ...safe, hasPassword: passwordHash !== null }));
}
