import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthService } from "@/domain/auth/service";
import type { SmsGateway } from "@/infrastructure/sms/gateway";
import { hashCode } from "@/domain/auth/code";

// mock 审计模块，避免依赖真实数据库
vi.mock("@/domain/shared/audit", () => ({ writeAudit: vi.fn().mockResolvedValue({}) }));

type CodeRow = {
  id: string;
  target: string;
  codeHash: string;
  purpose: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  createdAt: Date;
};

/** 内存版 prisma，仅实现 AuthService 用到的方法。 */
function makeMemoryDb(nowRef: { value: Date }) {
  const codes: CodeRow[] = [];
  const users: Array<{ id: string; phone: string; roles: string[]; kycStatus: string; reputationScore: number; nickname: string | null }> = [];
  let cid = 0;
  let uid = 0;

  const db = {
    verificationCode: {
      findFirst: async ({ where, orderBy }: any) => {
        let rows = codes.filter((c) => c.target === where.target && c.purpose === where.purpose);
        if (where.consumedAt === null) rows = rows.filter((c) => c.consumedAt === null);
        if (where.createdAt?.gte) rows = rows.filter((c) => c.createdAt >= where.createdAt.gte);
        rows.sort((a, b) => (orderBy?.createdAt === "desc" ? b.createdAt.getTime() - a.createdAt.getTime() : a.createdAt.getTime() - b.createdAt.getTime()));
        return rows[0] ?? null;
      },
      create: async ({ data }: any) => {
        const row: CodeRow = {
          id: `c${++cid}`,
          target: data.target,
          codeHash: data.codeHash,
          purpose: data.purpose,
          expiresAt: data.expiresAt,
          consumedAt: null,
          attempts: 0,
          createdAt: nowRef.value,
        };
        codes.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = codes.find((c) => c.id === where.id)!;
        if (data.attempts && typeof data.attempts === "object") row.attempts += data.attempts.increment;
        if (data.consumedAt) row.consumedAt = data.consumedAt;
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        codes.forEach((c) => {
          const idMatch = where.id ? c.id === where.id : true;
          const targetMatch = where.target ? c.target === where.target && c.purpose === where.purpose : true;
          const unconsumed = where.consumedAt === null ? c.consumedAt === null : true;
          if (idMatch && targetMatch && unconsumed) {
            if (data.attempts !== undefined) c.attempts = data.attempts;
            if (data.consumedAt !== undefined) c.consumedAt = data.consumedAt;
            count++;
          }
        });
        return { count };
      },
    },
    user: {
      upsert: async ({ where, create }: any) => {
        const existing = users.find((x) => x.phone === where.phone);
        if (existing) return existing;
        const created = {
          id: `u${++uid}`,
          phone: String(create.phone),
          roles: create.roles ?? [],
          kycStatus: create.kycStatus ?? "NONE",
          reputationScore: create.reputationScore ?? 0,
          nickname: null,
        };
        users.push(created);
        return created;
      },
      findUnique: async ({ where }: any) => users.find((x) => x.id === where.id) ?? null,
    },
  };
  return { db: db as any, codes, users };
}

function captureSms(): { gateway: SmsGateway; lastCode: () => string } {
  let last = "";
  return {
    gateway: {
      sendCode: async ({ code }: { code: string }) => {
        last = code;
      },
    },
    lastCode: () => last,
  };
}

describe("AuthService", () => {
  let nowRef: { value: Date };
  let mem: ReturnType<typeof makeMemoryDb>;
  let sms: ReturnType<typeof captureSms>;
  let service: AuthService;

  beforeEach(() => {
    nowRef = { value: new Date("2026-11-20T12:00:00Z") };
    mem = makeMemoryDb(nowRef);
    sms = captureSms();
    service = new AuthService(sms.gateway, mem.db, () => nowRef.value);
  });

  it("拒绝非法手机号", async () => {
    const res = await service.requestCode({ phone: "123" });
    expect(res.ok).toBe(false);
  });

  it("同一手机号 60 秒内重复请求被限流", async () => {
    expect((await service.requestCode({ phone: "13800138000" })).ok).toBe(true);
    const res = await service.requestCode({ phone: "13800138000" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("RATE_LIMITED");
  });

  it("正确验证码：首次登录自动注册并返回 JWT", async () => {
    await service.requestCode({ phone: "13800138000" });
    const res = await service.verifyCode({ phone: "13800138000", code: sms.lastCode() });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.token).toBeTypeOf("string");
      expect(res.value.user.phone).toBe("13800138000");
      expect(res.value.user.roles).toContain("BACKER");
    }
    expect(mem.users).toHaveLength(1);
  });

  it("二次登录复用同一账号，不重复建号", async () => {
    await service.requestCode({ phone: "13800138000" });
    await service.verifyCode({ phone: "13800138000", code: sms.lastCode() });
    nowRef.value = new Date(nowRef.value.getTime() + 61_000);
    await service.requestCode({ phone: "13800138000" });
    await service.verifyCode({ phone: "13800138000", code: sms.lastCode() });
    expect(mem.users).toHaveLength(1);
  });

  it("验证码错误计入尝试次数", async () => {
    await service.requestCode({ phone: "13800138000" });
    const wrong = sms.lastCode() === "000000" ? "111111" : "000000";
    const res = await service.verifyCode({ phone: "13800138000", code: wrong });
    expect(res.ok).toBe(false);
    expect(mem.codes.at(0)?.attempts).toBe(1);
  });

  it("验证码过期被拒绝", async () => {
    await service.requestCode({ phone: "13800138000" });
    nowRef.value = new Date(nowRef.value.getTime() + 5 * 60_000 + 1_000);
    const res = await service.verifyCode({ phone: "13800138000", code: sms.lastCode() });
    expect(res.ok).toBe(false);
  });

  it("已消费的验证码不能重复使用", async () => {
    await service.requestCode({ phone: "13800138000" });
    const code = sms.lastCode();
    expect((await service.verifyCode({ phone: "13800138000", code })).ok).toBe(true);
    const res = await service.verifyCode({ phone: "13800138000", code });
    expect(res.ok).toBe(false);
  });
});
