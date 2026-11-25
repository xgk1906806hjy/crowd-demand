import { UserRole, KycStatus } from "@prisma/client";
import type { SmsGateway } from "@/infrastructure/sms/gateway";
import { createEmailGateway, type EmailGateway } from "@/infrastructure/email/gateway";
import { prisma } from "@/infrastructure/prisma/client";
import { generateCode, hashCode, safeHashEqual } from "@/domain/auth/code";
import { hashPassword, verifyPassword, validatePasswordStrength } from "@/domain/auth/password";
import { normalizeUsername, validateUsername, USERNAME_RE } from "@/domain/auth/username";
import { writeAudit } from "@/domain/shared/audit";
import { ok, err, DomainError, type Result } from "@/domain/shared/result";
import { signSession } from "@/lib/session";

const PHONE_RE = /^1[3-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;
const CODE_TTL_MS = 5 * 60 * 1000; // 5 分钟
const RESEND_INTERVAL_MS = 60 * 1000; // 60 秒限流
const MAX_ATTEMPTS = 5;

/** 密码登录防爆破（F31）：连续失败 5 次锁定 15 分钟。 */
const PASSWORD_MAX_FAILED = 5;
const PASSWORD_LOCK_MS = 15 * 60 * 1000;
/** 防枚举：账号不存在 / 未设密码 / 密码错误统一文案。 */
const PASSWORD_FAIL_TEXT = "账号或密码错误。还没有账号？可直接注册，或改用验证码登录";

/** 免验证码注册防批量（F32）：同一 IP 每小时最多成功注册 5 个账号。 */
const REGISTER_MAX_PER_IP = 5;
const REGISTER_WINDOW_MS = 60 * 60 * 1000;
const registerHits = new Map<string, number[]>();

function registerAllowed(ip: string, now: Date): boolean {
  const cutoff = now.getTime() - REGISTER_WINDOW_MS;
  const hits = (registerHits.get(ip) ?? []).filter((t) => t > cutoff);
  registerHits.set(ip, hits);
  // 防止 Map 无界增长：条目过多时整体清理过期 IP
  if (registerHits.size > 1000) {
    for (const [key, list] of registerHits) {
      const alive = list.filter((t) => t > cutoff);
      if (alive.length === 0) registerHits.delete(key);
      else registerHits.set(key, alive);
    }
  }
  return hits.length < REGISTER_MAX_PER_IP;
}

function recordRegister(ip: string, now: Date): void {
  const hits = registerHits.get(ip) ?? [];
  hits.push(now.getTime());
  registerHits.set(ip, hits);
}

export type CodePurpose = "LOGIN" | "BIND";

export interface RequestCodeInput {
  phone?: string;
  email?: string;
  purpose?: CodePurpose;
  ip?: string;
}

export interface VerifyCodeInput {
  phone?: string;
  email?: string;
  code: string;
  ip?: string;
}

export interface LoginResultValue {
  token: string;
  user: {
    id: string;
    phone: string | null;
    email: string | null;
    username: string | null;
    nickname: string | null;
    roles: string[];
    kycStatus: string;
  };
}

interface ResolvedTarget {
  kind: "phone" | "email";
  target: string;
  channel: "sms" | "email";
}

function resolveTarget(input: { phone?: string; email?: string }): Result<ResolvedTarget> {
  const hasPhone = typeof input.phone === "string" && input.phone.trim() !== "";
  const hasEmail = typeof input.email === "string" && input.email.trim() !== "";
  if (hasPhone === hasEmail) {
    return err("请提供手机号或邮箱其中之一", DomainError.VALIDATION);
  }
  if (hasPhone) {
    const phone = (input.phone as string).trim();
    if (!PHONE_RE.test(phone)) return err("手机号格式不正确", DomainError.VALIDATION);
    return ok({ kind: "phone", target: phone, channel: "sms" });
  }
  const email = (input.email as string).trim().toLowerCase();
  if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) {
    return err("邮箱格式不正确", DomainError.VALIDATION);
  }
  return ok({ kind: "email", target: email, channel: "email" });
}

/** 认证领域服务。db 与适配器可注入，便于单元测试。 */
export class AuthService {
  constructor(
    private readonly sms: SmsGateway,
    private readonly db: typeof prisma = prisma,
    private readonly now: () => Date = () => new Date(),
    private readonly email: EmailGateway = createEmailGateway(),
  ) {}

  /** 请求验证码（手机号短信 / 邮箱邮件；purpose=BIND 用于邮箱绑定）。 */
  async requestCode(input: RequestCodeInput): Promise<Result<{ sent: true; expiresIn: number }>> {
    const resolved = resolveTarget(input);
    if (!resolved.ok) return err(resolved.error, resolved.code);
    const { kind, target, channel } = resolved.value;
    const purpose: CodePurpose = input.purpose ?? "LOGIN";

    const now = this.now();
    const recent = await this.db.verificationCode.findFirst({
      where: {
        target,
        purpose,
        createdAt: { gte: new Date(now.getTime() - RESEND_INTERVAL_MS) },
      },
      orderBy: { createdAt: "desc" },
    });
    if (recent) {
      return err("请求过于频繁，请 60 秒后再试", DomainError.RATE_LIMITED);
    }

    // 作废旧验证码：把同标识同用途且未消费的记录标记为 attempts 超限
    await this.db.verificationCode.updateMany({
      where: { target, purpose, consumedAt: null },
      data: { attempts: MAX_ATTEMPTS },
    });

    const code = generateCode();
    await this.db.verificationCode.create({
      data: {
        target,
        channel,
        codeHash: hashCode(code, target),
        purpose,
        expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      },
    });

    if (kind === "phone") {
      await this.sms.sendCode({ phone: target, code, purpose });
    } else {
      await this.email.sendCode({ email: target, code, purpose });
    }
    await writeAudit({
      action: "AUTH",
      target: `${kind}:${target}`,
      detail: { event: "CODE_SENT", channel, purpose },
      ip: input.ip,
    });

    return ok({ sent: true as const, expiresIn: CODE_TTL_MS / 1000 });
  }

  /**
   * 校验并消费验证码（一次性）。LOGIN 与 BIND 码互相隔离。
   * 返回消费成功的记录；任何失败都已写入尝试计数/审计。
   */
  private async consumeCode(
    target: string,
    kind: "phone" | "email",
    code: string,
    purpose: CodePurpose,
    ip?: string,
  ): Promise<Result<{ id: string }>> {
    if (!/^\d{6}$/.test(code)) {
      return err("验证码为 6 位数字", DomainError.VALIDATION);
    }
    const now = this.now();
    const record = await this.db.verificationCode.findFirst({
      where: { target, purpose, consumedAt: null },
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

    const providedHash = hashCode(code, target);
    if (!safeHashEqual(providedHash, record.codeHash)) {
      await this.db.verificationCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      await writeAudit({
        action: "AUTH",
        target: `${kind}:${target}`,
        detail: { event: "CODE_WRONG", purpose },
        ip,
      });
      return err("验证码错误", DomainError.VALIDATION);
    }

    // 条件更新防并发重复消费
    const consumed = await this.db.verificationCode.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count === 0) {
      return err("验证码已被使用", DomainError.CONFLICT);
    }
    return ok({ id: record.id });
  }

  /** 校验验证码并完成注册/登录，返回 JWT。手机号与邮箱均支持，首次登录即注册。 */
  async verifyCode(input: VerifyCodeInput): Promise<Result<LoginResultValue>> {
    const resolved = resolveTarget(input);
    if (!resolved.ok) return err(resolved.error, resolved.code);
    const { kind, target } = resolved.value;

    const consumed = await this.consumeCode(target, kind, input.code, "LOGIN", input.ip);
    if (!consumed.ok) return err(consumed.error, consumed.code);

    // upsert 用户：首次登录即注册。唯一键保证幂等；邮箱注册不与手机号账号自动合并。
    const user =
      kind === "phone"
        ? await this.db.user.upsert({
            where: { phone: target },
            create: {
              phone: target,
              roles: [UserRole.BACKER],
              kycStatus: KycStatus.NONE,
              reputationScore: 0,
            },
            update: {},
          })
        : await this.db.user.upsert({
            where: { email: target },
            create: {
              email: target,
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
      detail: { event: "LOGIN_SUCCESS", method: `${kind}-code` },
      ip: input.ip,
    });

    return ok({ token, user: this.toLoginUser(user) });
  }

  /** 用户名密码注册（F32）：免手机/邮箱验证码，注册成功即签发会话。 */
  async register(input: {
    username: string;
    password: string;
    ip?: string;
  }): Promise<Result<LoginResultValue>> {
    const username = normalizeUsername(input.username ?? "");
    const usernameError = validateUsername(username);
    if (usernameError) return err(usernameError, DomainError.VALIDATION);
    const strengthError = validatePasswordStrength(input.password);
    if (strengthError) return err(strengthError, DomainError.VALIDATION);

    const now = this.now();
    if (input.ip && !registerAllowed(input.ip, now)) {
      return err("注册过于频繁，请 1 小时后再试", DomainError.RATE_LIMITED);
    }

    const existing = await this.db.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (existing) return err("该用户名已被使用", DomainError.CONFLICT);

    const passwordHash = await hashPassword(input.password);
    let user;
    try {
      user = await this.db.user.create({
        data: {
          username,
          nickname: username,
          passwordHash,
          roles: [UserRole.BACKER],
          kycStatus: KycStatus.NONE,
          reputationScore: 0,
        },
      });
    } catch (e) {
      // 并发注册撞唯一约束：与显式查重同文案
      if ((e as { code?: string }).code === "P2002") {
        return err("该用户名已被使用", DomainError.CONFLICT);
      }
      throw e;
    }
    if (input.ip) recordRegister(input.ip, now);

    const token = await signSession({
      userId: user.id,
      roles: user.roles,
      phone: user.phone,
    });
    await writeAudit({
      action: "AUTH",
      actorId: user.id,
      target: `user:${user.id}`,
      detail: { event: "REGISTER_SUCCESS", method: "username" },
      ip: input.ip,
    });
    return ok({ token, user: this.toLoginUser(user) });
  }

  /** 设置/修改密码（F31）。已有密码时必须提供旧密码。 */
  async setPassword(
    userId: string,
    input: { password: string; currentPassword?: string; ip?: string },
  ): Promise<Result<{ updated: true }>> {
    const strengthError = validatePasswordStrength(input.password);
    if (strengthError) return err(strengthError, DomainError.VALIDATION);

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (!user) return err("用户不存在", DomainError.NOT_FOUND);

    if (user.passwordHash) {
      if (!input.currentPassword) {
        return err("修改密码需提供当前密码", DomainError.VALIDATION);
      }
      const match = await verifyPassword(input.currentPassword, user.passwordHash);
      if (!match) return err("当前密码不正确", DomainError.FORBIDDEN);
    }

    const passwordHash = await hashPassword(input.password);
    await this.db.user.update({
      where: { id: userId },
      data: { passwordHash, passwordFailedAttempts: 0, passwordLockedUntil: null },
    });
    await writeAudit({
      action: "AUTH",
      actorId: userId,
      target: `user:${userId}`,
      detail: { event: "PASSWORD_SET" },
      ip: input.ip,
    });
    return ok({ updated: true as const });
  }

  /** 密码登录（F31/F32）：账号 = 用户名、手机号或邮箱；防枚举 + 失败锁定。 */
  async passwordLogin(input: {
    account: string;
    password: string;
    ip?: string;
  }): Promise<Result<LoginResultValue>> {
    const account = input.account.trim();
    const isPhone = PHONE_RE.test(account);
    const email = account.toLowerCase();
    const isEmail = !isPhone && EMAIL_RE.test(email) && email.length <= EMAIL_MAX;
    const username = normalizeUsername(account);
    const isUsername = !isPhone && !isEmail && USERNAME_RE.test(username);
    if (!isPhone && !isEmail && !isUsername) {
      return err("账号需为用户名、手机号或邮箱", DomainError.VALIDATION);
    }
    if (!input.password) {
      return err("请输入密码", DomainError.VALIDATION);
    }

    const user = await this.db.user.findUnique({
      where: isPhone ? { phone: account } : isEmail ? { email } : { username },
      select: {
        id: true,
        phone: true,
        email: true,
        username: true,
        nickname: true,
        roles: true,
        kycStatus: true,
        passwordHash: true,
        passwordFailedAttempts: true,
        passwordLockedUntil: true,
      },
    });
    // 防枚举：账号不存在与密码错误返回同一文案
    if (!user || !user.passwordHash) {
      return err(PASSWORD_FAIL_TEXT, DomainError.UNAUTHORIZED);
    }

    const now = this.now();
    if (user.passwordLockedUntil && user.passwordLockedUntil.getTime() > now.getTime()) {
      const minutes = Math.ceil((user.passwordLockedUntil.getTime() - now.getTime()) / 60_000);
      return err(
        `密码错误次数过多，账号已临时锁定，请 ${minutes} 分钟后重试`,
        DomainError.RATE_LIMITED,
      );
    }

    const match = await verifyPassword(input.password, user.passwordHash);
    if (!match) {
      const failed = user.passwordFailedAttempts + 1;
      const lock = failed >= PASSWORD_MAX_FAILED;
      await this.db.user.update({
        where: { id: user.id },
        data: {
          passwordFailedAttempts: lock ? 0 : failed,
          passwordLockedUntil: lock ? new Date(now.getTime() + PASSWORD_LOCK_MS) : null,
        },
      });
      await writeAudit({
        action: "AUTH",
        actorId: user.id,
        target: `user:${user.id}`,
        detail: { event: lock ? "PASSWORD_LOCKED" : "PASSWORD_WRONG", failed },
        ip: input.ip,
      });
      if (lock) {
        return err(
          "密码错误次数过多，账号已临时锁定 15 分钟，请稍后重试",
          DomainError.RATE_LIMITED,
        );
      }
      return err(PASSWORD_FAIL_TEXT, DomainError.UNAUTHORIZED);
    }

    // 成功：清零失败计数与锁定
    if (user.passwordFailedAttempts > 0 || user.passwordLockedUntil) {
      await this.db.user.update({
        where: { id: user.id },
        data: { passwordFailedAttempts: 0, passwordLockedUntil: null },
      });
    }

    const token = await signSession({
      userId: user.id,
      roles: user.roles,
      phone: user.phone,
    });
    await writeAudit({
      action: "AUTH",
      actorId: user.id,
      target: `user:${user.id}`,
      detail: { event: "LOGIN_SUCCESS", method: "password" },
      ip: input.ip,
    });
    return ok({ token, user: this.toLoginUser(user) });
  }

  /** 绑定邮箱（F31）：登录态 + BIND 验证码；邮箱全局唯一，不自动合并账号。 */
  async bindEmail(
    userId: string,
    input: { email: string; code: string; ip?: string },
  ): Promise<Result<{ email: string }>> {
    const resolved = resolveTarget({ email: input.email });
    if (!resolved.ok) return err(resolved.error, resolved.code);
    const email = resolved.value.target;

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) return err("用户不存在", DomainError.NOT_FOUND);
    if (user.email === email) return ok({ email });

    const occupied = await this.db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (occupied) {
      return err("该邮箱已被其他账号使用", DomainError.CONFLICT);
    }

    const consumed = await this.consumeCode(email, "email", input.code, "BIND", input.ip);
    if (!consumed.ok) return err(consumed.error, consumed.code);

    await this.db.user.update({ where: { id: userId }, data: { email } });
    await writeAudit({
      action: "AUTH",
      actorId: userId,
      target: `user:${userId}`,
      detail: { event: "EMAIL_BOUND" },
      ip: input.ip,
    });
    return ok({ email });
  }

  private toLoginUser(user: {
    id: string;
    phone: string | null;
    email?: string | null;
    username?: string | null;
    nickname: string | null;
    roles: UserRole[];
    kycStatus: KycStatus;
  }): LoginResultValue["user"] {
    return {
      id: user.id,
      phone: user.phone,
      email: user.email ?? null,
      username: user.username ?? null,
      nickname: user.nickname,
      roles: user.roles.map(String),
      kycStatus: String(user.kycStatus),
    };
  }
}
