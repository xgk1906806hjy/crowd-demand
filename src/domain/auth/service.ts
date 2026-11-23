import { UserRole, KycStatus } from "@prisma/client";
import type { SmsGateway } from "@/infrastructure/sms/gateway";
import { prisma } from "@/infrastructure/prisma/client";
import { generateCode, hashCode, safeHashEqual } from "@/domain/auth/code";
import { writeAudit } from "@/domain/shared/audit";
import { ok, err, DomainError, type Result } from "@/domain/shared/result";
import { signSession } from "@/lib/session";

const PHONE_RE = /^1[3-9]\d{9}$/;
const CODE_TTL_MS = 5 * 60 * 1000; // 5 分钟
const RESEND_INTERVAL_MS = 60 * 1000; // 60 秒限流
const MAX_ATTEMPTS = 5;
const PURPOSE = "LOGIN";

export interface RequestCodeInput {
  phone: string;
  ip?: string;
}

export interface VerifyCodeInput {
  phone: string;
  code: string;
  ip?: string;
}

export interface LoginResultValue {
  token: string;
  user: {
    id: string;
    phone: string | null;
    nickname: string | null;
    roles: string[];
    kycStatus: string;
  };
}

/** 认证领域服务。db 与 sms 可注入，便于单元测试。 */
export class AuthService {
  constructor(
    private readonly sms: SmsGateway,
    private readonly db: typeof prisma = prisma,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** 请求登录验证码。 */
  async requestCode(input: RequestCodeInput): Promise<Result<{ sent: true; expiresIn: number }>> {
    if (!PHONE_RE.test(input.phone)) {
      return err("手机号格式不正确", DomainError.VALIDATION);
    }

    const now = this.now();
    const recent = await this.db.verificationCode.findFirst({
      where: {
        target: input.phone,
        purpose: PURPOSE,
        createdAt: { gte: new Date(now.getTime() - RESEND_INTERVAL_MS) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (recent) {
      return err("请求过于频繁，请 60 秒后再试", DomainError.RATE_LIMITED);
    }

    // 作废旧验证码：把同手机号同用途且未消费的记录标记为 attempts 超限
    await this.db.verificationCode.updateMany({
      where: { target: input.phone, purpose: PURPOSE, consumedAt: null },
      data: { attempts: MAX_ATTEMPTS },
    });

    const code = generateCode();
    await this.db.verificationCode.create({
      data: {
        target: input.phone,
        channel: "sms",
        codeHash: hashCode(code, input.phone),
        purpose: PURPOSE,
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      },
    });

    await this.sms.sendCode({ phone: input.phone, code, purpose: PURPOSE });
    await writeAudit({
      action: "AUTH",
      target: `phone:${input.phone}`,
      detail: { event: "CODE_SENT" },
      ip: input.ip,
    });

    return ok({ sent: true as const, expiresIn: CODE_TTL_MS / 1000 });
  }

  /** 校验验证码并完成注册/登录，返回 JWT。 */
  async verifyCode(input: VerifyCodeInput): Promise<Result<LoginResultValue>> {
    if (!PHONE_RE.test(input.phone)) {
      return err("手机号格式不正确", DomainError.VALIDATION);
    }
    if (!/^\d{6}$/.test(input.code)) {
      return err("验证码为 6 位数字", DomainError.VALIDATION);
    }

    const now = this.now();
    const record = await this.db.verificationCode.findFirst({
      where: { target: input.phone, purpose: PURPOSE, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!record) {
      return err("验证码不存在或已使用，请重新获取", DomainError.NOT_FOUND);
    }
    if (record.expiresAt.getTime() <= now.getTime()) {
      return err("验证码已过期，请重新获取", DomainError.VALIDATION);
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      return err("尝试次数过多，请重新获取验证码", DomainError.RATE_LIMITED);
    }

    const providedHash = hashCode(input.code, input.phone);
    if (!safeHashEqual(providedHash, record.codeHash)) {
      await this.db.verificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      await writeAudit({
        action: "AUTH",
        target: `phone:${input.phone}`,
        detail: { event: "CODE_WRONG" },
        ip: input.ip,
      });
      return err("验证码错误", DomainError.VALIDATION);
    }

    // 校验成功：消费验证码（条件更新防并发重复消费）
    const consumed = await this.db.verificationCode.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count === 0) {
      return err("验证码已被使用", DomainError.CONFLICT);
    }

    // upsert 用户：首次登录即注册。手机号唯一键保证幂等。
    const user = await this.db.user.upsert({
      where: { phone: input.phone },
      create: {
        phone: input.phone,
        roles: [UserRole.BACKER],
        kycStatus: KycStatus.NONE,
        reputationScore: 0,
      },
      update: {},
    });

    const token = await signSession({
      userId: user.id,
      roles: user.roles,
      phone: user.phone,
    });

    await writeAudit({
      action: "AUTH",
      actorId: user.id,
      target: `user:${user.id}`,
      detail: { event: "LOGIN_SUCCESS" },
      ip: input.ip,
    });

    return ok({
      token,
      user: {
        id: user.id,
        phone: user.phone,
        nickname: user.nickname,
        roles: user.roles.map(String),
        kycStatus: String(user.kycStatus),
      },
    });
  }
}
