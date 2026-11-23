import { KycStatus, UserRole } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma/client";
import { writeAudit } from "@/domain/shared/audit";
import { ok, err, DomainError, type Result } from "@/domain/shared/result";

/** 允许自助申请的角色；OPERATOR 只能后台授予。 */
const APPLICABLE_ROLES: UserRole[] = [UserRole.REQUESTER, UserRole.BUILDER];

export class RoleService {
  constructor(private readonly db: typeof prisma = prisma) {}

  async apply(
    userId: string,
    role: UserRole,
    ip?: string,
  ): Promise<Result<{ roles: UserRole[] }>> {
    if (!APPLICABLE_ROLES.includes(role)) {
      return err("该角色不支持自助申请", DomainError.VALIDATION);
    }

    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) return err("用户不存在", DomainError.NOT_FOUND);

    // 幂等：已拥有该角色直接返回
    if (user.roles.includes(role)) {
      return ok({ roles: user.roles });
    }

    // 开发者角色要求已实名
    if (role === UserRole.BUILDER && user.kycStatus !== KycStatus.VERIFIED) {
      return err("申请开发者角色需要先完成实名认证", DomainError.FORBIDDEN);
    }

    const updated = await this.db.user.update({
      where: { id: userId },
      data: { roles: [...user.roles, role] },
      select: { roles: true },
    });

    await writeAudit({
      action: "ROLE",
      actorId: userId,
      target: `user:${userId}`,
      detail: { event: "ROLE_GRANTED", role },
      ip,
    });

    return ok({ roles: updated.roles });
  }
}
