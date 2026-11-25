import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthService } from "@/domain/auth/service";
import { normalizeUsername, validateUsername } from "@/domain/auth/username";
import type { SmsGateway } from "@/infrastructure/sms/gateway";
import type { EmailGateway } from "@/infrastructure/email/gateway";

vi.mock("@/domain/shared/audit", () => ({ writeAudit: vi.fn().mockResolvedValue({}) }));

type UserRow = {
  id: string;
  phone: string | null;
  email: string | null;
  username: string | null;
  nickname: string | null;
  roles: string[];
  kycStatus: string;
  reputationScore: number;
  passwordHash: string | null;
  passwordFailedAttempts: number;
  passwordLockedUntil: Date | null;
};

/** 内存版 prisma：覆盖 F32 注册/用户名密码登录用到的方法。 */
function makeMemoryDb(nowRef: { value: Date }) {
  const users: UserRow[] = [];
  let uid = 0;
  let failCreateWithP2002 = false;

  function matchUser(where: Record<string, unknown>): UserRow | undefined {
    return users.find((u) => {
      if (where.id !== undefined && u.id !== where.id) return false;
      if (where.phone !== undefined && u.phone !== where.phone) return false;
      if (where.email !== undefined && u.email !== where.email) return false;
      if (where.username !== undefined && u.username !== where.username) return false;
      return true;
    });
  }

  const db = {
    user: {
      create: async ({ data }: any) => {
        if (failCreateWithP2002) {
          failCreateWithP2002 = false;
          throw Object.assign(new Error("unique constraint"), { code: "P2002" });
        }
        const created: UserRow = {
          id: `u${++uid}`,
          phone: data.phone ?? null,
          email: data.email ?? null,
          username: data.username ?? null,
          nickname: data.nickname ?? null,
          roles: data.roles ?? [],
          kycStatus: data.kycStatus ?? "NONE",
          reputationScore: data.reputationScore ?? 0,
          passwordHash: data.passwordHash ?? null,
          passwordFailedAttempts: 0,
          passwordLockedUntil: null,
        };
        users.push(created);
        return created;
      },
      findUnique: async ({ where }: any) => matchUser(where) ?? null,
      update: async ({ where, data }: any) => {
        const u = matchUser(where);
        if (!u) throw new Error("user not found");
        Object.assign(u, data);
        return u;
      },
      upsert: async ({ where, create }: any) => {
        const existing = matchUser(where);
        if (existing) return existing;
        return db.user.create({ data: create });
      },
    },
  };
  return { db: db as any, users, simulateRace: () => (failCreateWithP2002 = true) };
}

const noopSms: SmsGateway = { sendCode: async () => undefined };
const noopEmail: EmailGateway = { sendCode: async () => undefined };

const GOOD_PW = "1Aa!2345";
// 注册限流是进程内滑动窗口：各用例使用独立 IP，避免相互污染
let ipSeq = 0;
const freshIp = () => `10.9.${Math.floor(++ipSeq / 250)}.${ipSeq % 250 + 1}`;

describe("用户名规则（F32）", () => {
  it("归一化：去空白 + 转小写", () => {
    expect(normalizeUsername("  Alice_1 ")).toBe("alice_1");
  });

  it("长度边界：3 位拒绝、4 位合法、20 位合法、21 位拒绝", () => {
    expect(validateUsername("ab1")).not.toBeNull();
    expect(validateUsername("ab12")).toBeNull();
    expect(validateUsername("a" + "b".repeat(19))).toBeNull();
    expect(validateUsername("a" + "b".repeat(20))).not.toBeNull();
  });

  it("必须字母开头：数字/下划线开头拒绝", () => {
    expect(validateUsername("1abc")).not.toBeNull();
    expect(validateUsername("_abc")).not.toBeNull();
  });

  it("非法字符拒绝：连字符、点、@、中文、空格", () => {
    for (const bad of ["ab-cd", "ab.cd", "ab@cd", "用户名ab", "ab cd"]) {
      expect(validateUsername(bad)).not.toBeNull();
    }
  });

  it("纯数字被拒绝（与手机号标识空间隔离）", () => {
    expect(validateUsername("13800138000")).not.toBeNull();
  });

  it("保留词拒绝", () => {
    expect(validateUsername("admin")).not.toBeNull();
    expect(validateUsername("system")).not.toBeNull();
    expect(validateUsername("official")).not.toBeNull();
  });
});

describe("AuthService 用户名密码注册（F32）", () => {
  let nowRef: { value: Date };
  let mem: ReturnType<typeof makeMemoryDb>;
  let service: AuthService;

  beforeEach(() => {
    nowRef = { value: new Date("2026-11-23T12:00:00Z") };
    mem = makeMemoryDb(nowRef);
    service = new AuthService(noopSms, mem.db, () => nowRef.value, noopEmail);
  });

  it("注册成功：小写落库、密码哈希、默认角色与昵称、签发会话", async () => {
    const res = await service.register({ username: "Alice_1", password: GOOD_PW, ip: freshIp() });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.token).toBeTruthy();
      expect(res.value.user.username).toBe("alice_1");
      expect(res.value.user.nickname).toBe("alice_1");
      expect(res.value.user.phone).toBeNull();
      expect(res.value.user.email).toBeNull();
      expect(res.value.user.roles).toEqual(["BACKER"]);
      expect(res.value.user.kycStatus).toBe("NONE");
    }
    expect(mem.users).toHaveLength(1);
    expect(mem.users[0]!.username).toBe("alice_1");
    expect(mem.users[0]!.passwordHash).toMatch(/^scrypt\$/);
  });

  it("注册后可用用户名 + 密码登录，大小写不敏感", async () => {
    await service.register({ username: "alice_1", password: GOOD_PW, ip: freshIp() });
    const res = await service.passwordLogin({ account: "ALICE_1", password: GOOD_PW });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.user.username).toBe("alice_1");
  });

  it("重复用户名返回 CONFLICT，不创建账号（含大小写变体）", async () => {
    await service.register({ username: "alice_1", password: GOOD_PW, ip: freshIp() });
    const res = await service.register({ username: "ALICE_1", password: GOOD_PW, ip: freshIp() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
    expect(mem.users).toHaveLength(1);
  });

  it("并发撞唯一约束（P2002）同样返回 CONFLICT", async () => {
    mem.simulateRace();
    const res = await service.register({ username: "race_user", password: GOOD_PW, ip: freshIp() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
    expect(mem.users).toHaveLength(0);
  });

  it("非法用户名与弱密码被拒绝，不落库", async () => {
    const bad = await service.register({ username: "1abc", password: GOOD_PW, ip: freshIp() });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("VALIDATION");
    const weak = await service.register({ username: "valid_name", password: "allletters", ip: freshIp() });
    expect(weak.ok).toBe(false);
    if (!weak.ok) expect(weak.code).toBe("VALIDATION");
    expect(mem.users).toHaveLength(0);
  });

  it("同 IP 每小时第 6 次注册被限流，不同 IP 不受影响", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      const r = await service.register({ username: `user_${i}`, password: GOOD_PW, ip });
      expect(r.ok).toBe(true);
    }
    const sixth = await service.register({ username: "user_5", password: GOOD_PW, ip });
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) expect(sixth.code).toBe("RATE_LIMITED");
    const other = await service.register({ username: "other_ip", password: GOOD_PW, ip: freshIp() });
    expect(other.ok).toBe(true);
    expect(mem.users).toHaveLength(6);
  });

  it("限流窗口过期后恢复", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      await service.register({ username: `win_${i}`, password: GOOD_PW, ip });
    }
    nowRef.value = new Date(nowRef.value.getTime() + 61 * 60 * 1000);
    const res = await service.register({ username: "win_again", password: GOOD_PW, ip });
    expect(res.ok).toBe(true);
  });

  it("失败的注册请求不占用限流额度", async () => {
    const ip = freshIp();
    for (let i = 0; i < 10; i++) {
      await service.register({ username: "1bad", password: GOOD_PW, ip });
    }
    const res = await service.register({ username: "after_bad", password: GOOD_PW, ip });
    expect(res.ok).toBe(true);
  });
});

describe("用户名账号的密码登录护栏（F32 复用 F31）", () => {
  let nowRef: { value: Date };
  let mem: ReturnType<typeof makeMemoryDb>;
  let service: AuthService;

  beforeEach(async () => {
    nowRef = { value: new Date("2026-11-23T12:00:00Z") };
    mem = makeMemoryDb(nowRef);
    service = new AuthService(noopSms, mem.db, () => nowRef.value, noopEmail);
    await service.register({ username: "guard_user", password: GOOD_PW, ip: freshIp() });
  });

  it("错误密码与不存在账号返回同一防枚举文案", async () => {
    const wrong = await service.passwordLogin({ account: "guard_user", password: "wrong1234" });
    const missing = await service.passwordLogin({ account: "no_such_user", password: GOOD_PW });
    expect(wrong.ok).toBe(false);
    expect(missing.ok).toBe(false);
    if (!wrong.ok && !missing.ok) {
      expect(wrong.code).toBe("UNAUTHORIZED");
      expect(wrong.error).toBe(missing.error);
    }
  });

  it("连续失败 5 次锁定 15 分钟，锁定期正确密码也被拒", async () => {
    for (let i = 0; i < 5; i++) {
      await service.passwordLogin({ account: "guard_user", password: "wrong1234" });
    }
    const locked = await service.passwordLogin({ account: "guard_user", password: GOOD_PW });
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.code).toBe("RATE_LIMITED");
    nowRef.value = new Date(nowRef.value.getTime() + 16 * 60 * 1000);
    const after = await service.passwordLogin({ account: "guard_user", password: GOOD_PW });
    expect(after.ok).toBe(true);
  });

  it("非法账号格式（既非用户名也非手机号/邮箱）被拒绝", async () => {
    const res = await service.passwordLogin({ account: "ab", password: GOOD_PW });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("回归：手机号账号密码登录不受影响", async () => {
    // 直接造一个手机号 + 密码账号（等价于 F31 验证码注册后设密码）
    const { hashPassword } = await import("@/domain/auth/password");
    await mem.db.user.create({
      data: { phone: "13800138000", passwordHash: await hashPassword(GOOD_PW), roles: ["BACKER"], kycStatus: "NONE" },
    });
    const res = await service.passwordLogin({ account: "13800138000", password: GOOD_PW });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.user.username).toBeNull();
  });
});
