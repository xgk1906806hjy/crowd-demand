import { KycStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma/client";
import type { KycGateway } from "@/infrastructure/kyc/gateway";
import { parseIdNumber } from "@/lib/id-number";
import { hashIdNumber, maskName } from "@/domain/kyc/hash";
import { writeAudit } from "@/domain/shared/audit";
import { ok, err, DomainError, type Result } from "@/domain/shared/result";

export interface SubmitKycInput {
  realName: string;
  idNumber: string;
  ip?: string;
}

export interface KycStatusView {
  kycStatus: KycStatus;
  realNameMasked: string | null;
  verifiedAt: Date | null;
  reason: string | null;
}

const NAME_RE = /^[\u4e00-\u9fa5A-Za-z·\s]{2,20}$/;

export class KycService {
  constructor(
    private readonly gateway: KycGateway,
    private readonly db: typeof prisma = prisma,
  ) {}

  /** 提交实名认证。 */
  async submit(
    userId: string,
    input: SubmitKycInput,
  ): Promise<Result<{ kycStatus: KycStatus; verifiedAt: Date | null }>> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) return err("用户不存在", DomainError.NOT_FOUND);

    // 已实名：直接返回，不重复核验
    if (user.kycStatus === KycStatus.VERIFIED) {
      return ok({ kycStatus: KycStatus.VERIFIED, verifiedAt: user.updatedAt });
    }

    const realName = input.realName.trim();
    if (!NAME_RE.test(realName)) {
      return err("姓名应为 2-20 个字符（中文、字母或·）", DomainError.VALIDATION);
    }

    // 前置校验：格式与校验码不通过则不核验、不落库
    const parsed = parseIdNumber(input.idNumber);
    if (!parsed.ok) return err(parsed.reason, DomainError.VALIDATION);

    const idNumber = input.idNumber.trim().toUpperCase();
    const idHash = hashIdNumber(idNumber);

    // 一人一号
    const occupied = await this.db.user.findUnique({
      where: { kycIdNumberHash: idHash },
      select: { id: true },
    });
    if (occupied && occupied.id !== userId) {
      return err("该身份证号已绑定其他账号", DomainError.CONFLICT);
    }

    // 进入 PENDING 并记录
    await this.db.user.update({ where: { id: userId }, data: { kycStatus: KycStatus.PENDING } });
    await this.db.kycRecord.create({
      data: {
        userId,
        realName,
        idNumberHash: idHash,
        provider: process.env.KYC_ADAPTER ?? "mock",
        status: KycStatus.PENDING,
      },
    });

    const verifyResult = await this.gateway.verify({ realName, idNumber });

    if (!verifyResult.passed) {
      await this.db.$transaction([
        this.db.user.update({ where: { id: userId }, data: { kycStatus: KycStatus.REJECTED } }),
        this.db.kycRecord.updateMany({
          where: { userId, status: KycStatus.PENDING },
          data: { status: KycStatus.REJECTED, reason: verifyResult.reason ?? "核验未通过" },
        }),
      ]);
      await writeAudit({
        action: "KYC",
        actorId: userId,
        target: `user:${userId}`,
        detail: { event: "KYC_REJECTED", reason: verifyResult.reason },
        ip: input.ip,
      });
      return err(verifyResult.reason ?? "实名核验未通过", DomainError.VALIDATION);
    }

    try {
      await this.db.$transaction([
        this.db.user.update({
          where: { id: userId },
          data: { kycStatus: KycStatus.VERIFIED, kycIdNumberHash: idHash },
        }),
        this.db.kycRecord.updateMany({
          where: { userId, status: KycStatus.PENDING },
          data: { status: KycStatus.VERIFIED },
        }),
      ]);
    } catch (e) {
      // 并发下唯一约束兜底
      if (isUniqueViolation(e)) return err("该身份证号已绑定其他账号", DomainError.CONFLICT);
      throw e;
    }

    await writeAudit({
      action: "KYC",
      actorId: userId,
      target: `user:${userId}`,
      detail: { event: "KYC_VERIFIED" },
      ip: input.ip,
    });
    return ok({ kycStatus: KycStatus.VERIFIED, verifiedAt: new Date() });
  }

  /** 查询当前用户认证状态（脱敏）。 */
  async status(userId: string): Promise<Result<KycStatusView>> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { kycStatus: true },
    });
    if (!user) return err("用户不存在", DomainError.NOT_FOUND);

    const record = await this.db.kycRecord.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return ok({
      kycStatus: user.kycStatus,
      realNameMasked: record ? maskName(record.realName) : null,
      verifiedAt:
        user.kycStatus === KycStatus.VERIFIED ? (record?.createdAt ?? null) : null,
      reason: record?.reason ?? null,
    });
  }

  /** 资金等功能的前置闸门：未实名则拒绝。 */
  async assertVerified(userId: string): Promise<Result<{ verified: true }>> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { kycStatus: true },
    });
    if (!user) return err("用户不存在", DomainError.NOT_FOUND);
    if (user.kycStatus !== KycStatus.VERIFIED) {
      return err("请先完成实名认证", DomainError.FORBIDDEN);
    }
    return ok({ verified: true });
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
