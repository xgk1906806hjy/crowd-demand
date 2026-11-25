import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthService } from "@/domain/auth/service";
import { hashPassword, verifyPassword, validatePasswordStrength } from "@/domain/auth/password";
import type { SmsGateway } from "@/infrastructure/sms/gateway";
import type { EmailGateway } from "@/infrastructure/email/gateway";

vi.mock("@/domain/shared/audit", () => ({ writeAudit: vi.fn().mockResolvedValue({}) }));

type CodeRow = {
  id: string;
  target: string;
  channel: string;
  codeHash: string;
  purpose: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
  createdAt: Date;
};

type UserRow = {
  id: string;
  phone: string | null;
  email: string | null;
  nickname: string | null;
  roles: string[];
  kycStatus: string;
  reputationScore: number;
  passwordHash: string | null;
  passwordFailedAttempts: number;
  passwordLockedUntil: Date | null;
};

/** 内存版 prisma：覆盖 AuthService 邮箱/密码/绑定路径用到的方法。 */
function makeMemoryDb(nowRef: { value: Date }) {
  const codes: CodeRow[] = [];
  const users: UserRow[] = [];
  let cid = 0;
  let uid = 0;

  function matchUser(where: Record<string, unknown>): UserRow | undefined {
    return users.find((u) => {
      if (where.id !== undefined && u.id !== where.id) return false;
      if (where.phone !== undefined && u.phone !== where.phone) return false;
      if (where.email !== undefined && u.email !== where.email) return false;
      return true;
    });
  }

  const db = {
    verificationCode: {
      findFirst: async ({ where, orderBy }: any) => {
        let rows = codes.filter((c) => c.target === where.target && c.purpose === where.purpose);
        if (where.consumedAt === null) rows = rows.filter((c) => c.consumedAt === null);
        if (where.createdAt?.gte) rows = rows.filter((c) => c.createdAt >= where.createdAt.gte);
        rows.sort((a, b) =>
          orderBy?.createdAt === "desc"
            ? b.createdAt.getTime() - a.createdAt.getTime()
            : a.createdAt.getTime() - b.createdAt.getTime(),
        );
        return rows[0] ?? null;
      },
      create: async ({ data }: any) => {
        const row: CodeRow = {
          id: `c${++cid}`,
          target: data.target,
          channel: data.channel,
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
        const existing = matchUser(where);
        if (existing) return existing;
        const created: UserRow = {
          id: `u${++uid}`,
          phone: create.phone ?? null,
          email: create.email ?? null,
          nickname: null,
          roles: create.roles ?? [],
          kycStatus: create.kycStatus ?? "NONE",
          reputationScore: create.reputationScore ?? 0,
          passwordHash: null,
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
    },
  };
  return { db: db as any, codes, users };
}

function captureChannels() {
  let smsCode = "";
  let emailCode = "";
  const sms: SmsGateway = {
    sendCode: async ({ code }) => {
      smsCode = code;
    },
  };
  const email: EmailGateway = {
    sendCode: async ({ code }) => {
      emailCode = code;
    },
  };
  return { sms, email, smsCode: () => smsCode, emailCode: () => emailCode };
}

const PHONE = "13800138000";
const EMAIL = "user@example.com";
const GOOD_PW = "1Aa!2345";

describe("AuthService 邮箱验证码登录（F01 v0.5）", () => {
  let nowRef: { value: Date };
  let mem: ReturnType<typeof makeMemoryDb>;
  let ch: ReturnType<typeof captureChannels>;
  let service: AuthService;

  beforeEach(() => {
    nowRef = { value: new Date("2026-11-23T12:00:00Z") };
    mem = makeMemoryDb(nowRef);
    ch = captureChannels();
    service = new AuthService(ch.sms, mem.db, () => nowRef.value, ch.email);
  });

  it("邮箱首次登录自动注册，phone 为空", async () => {
    expect((await service.requestCode({ email: EMAIL })).ok).toBe(true);
    const res = await service.verifyCode({ email: EMAIL, code: ch.emailCode() });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.user.email).toBe(EMAIL);
      expect(res.value.user.phone).toBeNull();
    }
    expect(mem.users).toHaveLength(1);
  });

  it("邮箱统一转小写", async () => {
    await service.requestCode({ email: "User@Example.COM" });
    const res = await service.verifyCode({ email: "USER@example.com", code: ch.emailCode() });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.user.email).toBe(EMAIL);
  });

  it("非法邮箱被拒绝", async () => {
    const res = await service.requestCode({ email: "not-an-email" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("手机号与邮箱同时传被拒绝", async () => {
    const res = await service.requestCode({ phone: PHONE, email: EMAIL });
    expect(res.ok).toBe(false);
  });

  it("同一邮箱 60 秒内重复请求被限流", async () => {
    await service.requestCode({ email: EMAIL });
    const res = await service.requestCode({ email: EMAIL });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("RATE_LIMITED");
  });

  it("邮箱注册不与手机号账号自动合并", async () => {
    await service.requestCode({ phone: PHONE });
    await service.verifyCode({ phone: PHONE, code: ch.smsCode() });
    await service.requestCode({ email: EMAIL });
    await service.verifyCode({ email: EMAIL, code: ch.emailCode() });
    expect(mem.users).toHaveLength(2);
  });
});

describe("AuthService 密码登录（F31）", () => {
  let nowRef: { value: Date };
  let mem: ReturnType<typeof makeMemoryDb>;
  let ch: ReturnType<typeof captureChannels>;
  let service: AuthService;

  beforeEach(async () => {
    nowRef = { value: new Date("2026-11-23T12:00:00Z") };
    mem = makeMemoryDb(nowRef);
    ch = captureChannels();
    service = new AuthService(ch.sms, mem.db, () => nowRef.value, ch.email);
    // 注册一个手机号账号
    await service.requestCode({ phone: PHONE });
    await service.verifyCode({ phone: PHONE, code: ch.smsCode() });
  });

  it("设置密码后可用手机号+密码登录", async () => {
    const uid = mem.users[0]!.id;
    expect((await service.setPassword(uid, { password: GOOD_PW })).ok).toBe(true);
    const res = await service.passwordLogin({ account: PHONE, password: GOOD_PW });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.user.id).toBe(uid);
  });

  it("绑定邮箱后可用邮箱+密码登录", async () => {
    const uid = mem.users[0]!.id;
    await service.setPassword(uid, { password: GOOD_PW });
    nowRef.value = new Date(nowRef.value.getTime() + 61_000);
    await service.requestCode({ email: EMAIL, purpose: "BIND" });
    expect((await service.bindEmail(uid, { email: EMAIL, code: ch.emailCode() })).ok).toBe(true);
    const res = await service.passwordLogin({ account: EMAIL, password: GOOD_PW });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.user.id).toBe(uid);
  });

  it("弱密码被拒绝", async () => {
    const uid = mem.users[0]!.id;
    expect((await service.setPassword(uid, { password: "abc1" })).ok).toBe(false);
    expect((await service.setPassword(uid, { password: "abcdefgh" })).ok).toBe(false);
    expect((await service.setPassword(uid, { password: "12345678" })).ok).toBe(false);
  });

  it("改密必须提供正确的旧密码", async () => {
    const uid = mem.users[0]!.id;
    await service.setPassword(uid, { password: GOOD_PW });
    const noOld = await service.setPassword(uid, { password: "2Bb@5678" });
    expect(noOld.ok).toBe(false);
    const wrongOld = await service.setPassword(uid, {
      password: "2Bb@5678",
      currentPassword: "wrong1234",
    });
    expect(wrongOld.ok).toBe(false);
    const okRes = await service.setPassword(uid, {
      password: "2Bb@5678",
      currentPassword: GOOD_PW,
    });
    expect(okRes.ok).toBe(true);
    expect((await service.passwordLogin({ account: PHONE, password: "2Bb@5678" })).ok).toBe(true);
  });

  it("防枚举：账号不存在/未设密码/密码错误文案一致", async () => {
    const uid = mem.users[0]!.id;
    const noUser = await service.passwordLogin({ account: "13900139000", password: GOOD_PW });
    const noPw = await service.passwordLogin({ account: PHONE, password: GOOD_PW });
    await service.setPassword(uid, { password: GOOD_PW });
    const wrongPw = await service.passwordLogin({ account: PHONE, password: "wrong1234" });
    expect(noUser.ok).toBe(false);
    expect(noPw.ok).toBe(false);
    expect(wrongPw.ok).toBe(false);
    if (!noUser.ok && !noPw.ok && !wrongPw.ok) {
      expect(noUser.error).toBe(noPw.error);
      expect(noPw.error).toBe(wrongPw.error);
      expect(noUser.code).toBe("UNAUTHORIZED");
    }
  });

  it("连续失败 5 次锁定 15 分钟，锁定期正确密码也被拒", async () => {
    const uid = mem.users[0]!.id;
    await service.setPassword(uid, { password: GOOD_PW });
    for (let i = 0; i < 4; i++) {
      const res = await service.passwordLogin({ account: PHONE, password: "wrong1234" });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("UNAUTHORIZED");
    }
    const fifth = await service.passwordLogin({ account: PHONE, password: "wrong1234" });
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) expect(fifth.code).toBe("RATE_LIMITED");

    const locked = await service.passwordLogin({ account: PHONE, password: GOOD_PW });
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.code).toBe("RATE_LIMITED");

    // 15 分钟后解锁
    nowRef.value = new Date(nowRef.value.getTime() + 15 * 60_000 + 1_000);
    expect((await service.passwordLogin({ account: PHONE, password: GOOD_PW })).ok).toBe(true);
  });

  it("锁定期验证码登录不受影响", async () => {
    const uid = mem.users[0]!.id;
    await service.setPassword(uid, { password: GOOD_PW });
    for (let i = 0; i < 5; i++) {
      await service.passwordLogin({ account: PHONE, password: "wrong1234" });
    }
    nowRef.value = new Date(nowRef.value.getTime() + 61_000);
    await service.requestCode({ phone: PHONE });
    const res = await service.verifyCode({ phone: PHONE, code: ch.smsCode() });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.user.id).toBe(uid);
  });

  it("中途成功登录清零失败计数", async () => {
    const uid = mem.users[0]!.id;
    await service.setPassword(uid, { password: GOOD_PW });
    await service.passwordLogin({ account: PHONE, password: "wrong1234" });
    await service.passwordLogin({ account: PHONE, password: "wrong1234" });
    expect((await service.passwordLogin({ account: PHONE, password: GOOD_PW })).ok).toBe(true);
    expect(mem.users[0]!.passwordFailedAttempts).toBe(0);
  });
});

describe("AuthService 邮箱绑定（F31）", () => {
  let nowRef: { value: Date };
  let mem: ReturnType<typeof makeMemoryDb>;
  let ch: ReturnType<typeof captureChannels>;
  let service: AuthService;
  let uid: string;

  beforeEach(async () => {
    nowRef = { value: new Date("2026-11-23T12:00:00Z") };
    mem = makeMemoryDb(nowRef);
    ch = captureChannels();
    service = new AuthService(ch.sms, mem.db, () => nowRef.value, ch.email);
    await service.requestCode({ phone: PHONE });
    await service.verifyCode({ phone: PHONE, code: ch.smsCode() });
    uid = mem.users[0]!.id;
    nowRef.value = new Date(nowRef.value.getTime() + 61_000);
  });

  it("BIND 码绑定成功后手机号保留", async () => {
    await service.requestCode({ email: EMAIL, purpose: "BIND" });
    const res = await service.bindEmail(uid, { email: EMAIL, code: ch.emailCode() });
    expect(res.ok).toBe(true);
    expect(mem.users[0]!.email).toBe(EMAIL);
    expect(mem.users[0]!.phone).toBe(PHONE);
    expect(mem.users).toHaveLength(1);
  });

  it("LOGIN 码不能用于绑定（用途隔离）", async () => {
    await service.requestCode({ email: EMAIL }); // 默认 LOGIN
    const res = await service.bindEmail(uid, { email: EMAIL, code: ch.emailCode() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("BIND 码不能用于登录（用途隔离）", async () => {
    await service.requestCode({ email: EMAIL, purpose: "BIND" });
    const res = await service.verifyCode({ email: EMAIL, code: ch.emailCode() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("邮箱被其他账号占用时拒绝绑定", async () => {
    await service.requestCode({ email: EMAIL });
    await service.verifyCode({ email: EMAIL, code: ch.emailCode() });
    nowRef.value = new Date(nowRef.value.getTime() + 61_000);
    await service.requestCode({ email: EMAIL, purpose: "BIND" });
    const res = await service.bindEmail(uid, { email: EMAIL, code: ch.emailCode() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
  });

  it("错误验证码绑定被拒绝", async () => {
    await service.requestCode({ email: EMAIL, purpose: "BIND" });
    const wrong = ch.emailCode() === "000000" ? "111111" : "000000";
    const res = await service.bindEmail(uid, { email: EMAIL, code: wrong });
    expect(res.ok).toBe(false);
    expect(mem.users[0]!.email).toBeNull();
  });
});

describe("密码哈希（scrypt）", () => {
  it("强度校验规则：8 位、数字开头、大小写 + 特殊符号", () => {
    expect(validatePasswordStrength("1Aa!2345")).toBeNull();
    expect(validatePasswordStrength("9zZ#abcd")).toBeNull();
    expect(validatePasswordStrength("short1")).not.toBeNull(); // 不足 8 位
    expect(validatePasswordStrength("1Aa!23456")).not.toBeNull(); // 超过 8 位
    expect(validatePasswordStrength("Aa!12345")).not.toBeNull(); // 非数字开头
    expect(validatePasswordStrength("1aa!2345")).not.toBeNull(); // 缺大写
    expect(validatePasswordStrength("1AA!2345")).not.toBeNull(); // 缺小写
    expect(validatePasswordStrength("1Aa23456")).not.toBeNull(); // 缺特殊符号
    expect(validatePasswordStrength("12345678")).not.toBeNull(); // 纯数字
    expect(validatePasswordStrength("1Aa!234 ")).not.toBeNull(); // 含空格
    expect(validatePasswordStrength("1Aa!23中文")).not.toBeNull(); // 非 ASCII
  });

  it("同密码两次哈希不同（随机盐），但都能校验", async () => {
    const h1 = await hashPassword(GOOD_PW);
    const h2 = await hashPassword(GOOD_PW);
    expect(h1).not.toBe(h2);
    expect(h1.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword(GOOD_PW, h1)).toBe(true);
    expect(await verifyPassword(GOOD_PW, h2)).toBe(true);
    expect(await verifyPassword("wrong1234", h1)).toBe(false);
  });

  it("格式非法的存储串一律校验失败", async () => {
    expect(await verifyPassword(GOOD_PW, "plaintext")).toBe(false);
    expect(await verifyPassword(GOOD_PW, "md5$aa$bb")).toBe(false);
    expect(await verifyPassword(GOOD_PW, "scrypt$$")).toBe(false);
  });
});
