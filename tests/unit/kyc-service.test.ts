import { describe, it, expect, vi, beforeEach } from "vitest";
import { KycService } from "@/domain/kyc/service";
import { MockKycGateway } from "@/infrastructure/kyc/gateway";

vi.mock("@/domain/shared/audit", () => ({ writeAudit: vi.fn().mockResolvedValue({}) }));

const VALID_ID = "110101199003070011";

type MemUser = {
  id: string;
  kycStatus: string;
  kycIdNumberHash: string | null;
  updatedAt: Date;
};

function makeMemoryDb() {
  const users = new Map<string, MemUser>();
  const records: Array<Record<string, unknown> & { userId: string; createdAt: Date }> = [];
  let rid = 0;

  const db = {
    user: {
      findUnique: async ({ where }: any) => {
        if (where.id) return users.get(where.id) ?? null;
        if (where.kycIdNumberHash) {
          for (const u of users.values()) {
            if (u.kycIdNumberHash === where.kycIdNumberHash) return u;
          }
          return null;
        }
        return null;
      },
      update: async ({ where, data }: any) => {
        const u = users.get(where.id);
        if (!u) throw new Error("user not found");
        Object.assign(u, data, { updatedAt: new Date() });
        return u;
      },
    },
    kycRecord: {
      create: async ({ data }: any) => {
        const r = { id: `r${++rid}`, createdAt: new Date(), reason: null, ...data };
        records.push(r);
        return r;
      },
      findFirst: async ({ where }: any) => {
        const rows = records.filter((r) => r.userId === where.userId);
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows[0] ?? null;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        records.forEach((r) => {
          if (r.userId === where.userId && (where.status === undefined || r.status === where.status)) {
            Object.assign(r, data);
            count++;
          }
        });
        return { count };
      },
    },
    $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops),
  };

  return { db: db as any, users, records };
}

function addUser(users: Map<string, MemUser>, id: string): void {
  users.set(id, { id, kycStatus: "NONE", kycIdNumberHash: null, updatedAt: new Date() });
}

describe("KycService", () => {
  let mem: ReturnType<typeof makeMemoryDb>;
  let service: KycService;

  beforeEach(() => {
    mem = makeMemoryDb();
    addUser(mem.users, "u1");
    addUser(mem.users, "u2");
    service = new KycService(new MockKycGateway(), mem.db);
  });

  it("合法提交后变为 VERIFIED 并写入哈希（无明文）", async () => {
    const res = await service.submit("u1", { realName: "张三", idNumber: VALID_ID });
    expect(res.ok).toBe(true);
    const u = mem.users.get("u1")!;
    expect(u.kycStatus).toBe("VERIFIED");
    expect(u.kycIdNumberHash).toBeTruthy();
    expect(u.kycIdNumberHash).not.toContain(VALID_ID);
    expect(mem.records.some((r) => r.status === "VERIFIED")).toBe(true);
  });

  it("格式错误的身份证号不落库", async () => {
    const res = await service.submit("u1", { realName: "张三", idNumber: "1234" });
    expect(res.ok).toBe(false);
    expect(mem.users.get("u1")!.kycStatus).toBe("NONE");
    expect(mem.records).toHaveLength(0);
  });

  it("一人一号：同一身份证号不可绑定第二个账号", async () => {
    expect((await service.submit("u1", { realName: "张三", idNumber: VALID_ID })).ok).toBe(true);
    const res = await service.submit("u2", { realName: "李四", idNumber: VALID_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
    expect(mem.users.get("u2")!.kycStatus).toBe("NONE");
  });

  it("核验失败进入 REJECTED，可重新提交成功", async () => {
    const fail = await service.submit("u1", { realName: "拒绝测试", idNumber: VALID_ID });
    expect(fail.ok).toBe(false);
    expect(mem.users.get("u1")!.kycStatus).toBe("REJECTED");

    const retry = await service.submit("u1", { realName: "张三", idNumber: VALID_ID });
    expect(retry.ok).toBe(true);
    expect(mem.users.get("u1")!.kycStatus).toBe("VERIFIED");
  });

  it("已实名用户重复提交不重复核验", async () => {
    await service.submit("u1", { realName: "张三", idNumber: VALID_ID });
    const before = mem.records.length;
    const res = await service.submit("u1", { realName: "张三", idNumber: VALID_ID });
    expect(res.ok).toBe(true);
    expect(mem.records.length).toBe(before);
  });

  it("assertVerified：未实名拒绝，已实名通过", async () => {
    expect((await service.assertVerified("u1")).ok).toBe(false);
    await service.submit("u1", { realName: "张三", idNumber: VALID_ID });
    expect((await service.assertVerified("u1")).ok).toBe(true);
  });

  it("status 返回脱敏姓名且不含身份证号", async () => {
    await service.submit("u1", { realName: "张三丰", idNumber: VALID_ID });
    const res = await service.status("u1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.kycStatus).toBe("VERIFIED");
      expect(res.value.realNameMasked).toBe("张**");
      expect(JSON.stringify(res.value)).not.toContain(VALID_ID);
    }
  });
});
