import { describe, it, expect, vi, beforeEach } from "vitest";
import { KycStatus, NeedStatus, UserRole } from "@prisma/client";
import { NeedService, NEED_LIMITS } from "@/domain/need/service";

vi.mock("@/domain/shared/audit", () => ({ writeAudit: vi.fn().mockResolvedValue({}) }));

type MemUser = { id: string; roles: UserRole[]; kycStatus: KycStatus };
type MemNeed = Record<string, unknown> & { id: string; status: NeedStatus };

function makeDb() {
  const users = new Map<string, MemUser>();
  const needs = new Map<string, MemNeed>();
  const logs: Array<Record<string, unknown>> = [];
  let nid = 0;

  const db = {
    user: {
      findUnique: async ({ where }: { where: { id?: string } }) =>
        where.id ? (users.get(where.id) ?? null) : null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<MemUser> }) => {
        const u = users.get(where.id);
        if (!u) throw new Error("user not found");
        Object.assign(u, data);
        return u;
      },
    },
    need: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const n: MemNeed = {
          id: `n${++nid}`,
          voteCount: 0,
          pledgedAmount: 0n,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        } as unknown as MemNeed;
        needs.set(n.id, n);
        return n;
      },
      // 返回副本，模拟真实 Prisma 不共享对象引用
      findUnique: async ({ where }: { where: { id: string } }) => {
        const n = needs.get(where.id);
        return n ? { ...n } : null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const n = needs.get(where.id);
        if (!n) throw new Error("need not found");
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in (v as object)) {
            n[k] = (n[k] as number) + (v as { increment: number }).increment;
          } else if (v && typeof v === "object" && "decrement" in (v as object)) {
            n[k] = (n[k] as number) - (v as { decrement: number }).decrement;
          } else {
            n[k] = v;
          }
        }
        return n;
      },
      findMany: async () => [...needs.values()],
      count: async () => needs.size,
    },
    needStatusLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const l = { id: `l${logs.length + 1}`, createdAt: new Date(), ...data };
        logs.push(l);
        return l;
      },
    },
    $transaction: async (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (tx: unknown) => Promise<unknown>)(db)
        : Promise.all(arg as Promise<unknown>[]),
  };

  return { db, users, needs, logs };
}

const validInput = {
  title: "自动整理会议通知为日程",
  description:
    "团队每天在微信群里收到十几条会议通知，需要手动逐条复制到日历，经常漏掉或记错时间，希望有工具能自动识别并生成日程。",
  targetAmount: 500_000n,
  deadline: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  voteThreshold: 100,
};

describe("NeedService 需求发布（F04）", () => {
  let ctx: ReturnType<typeof makeDb>;
  let service: NeedService;

  beforeEach(() => {
    ctx = makeDb();
    service = new NeedService(ctx.db as never);
    ctx.users.set("u1", { id: "u1", roles: [UserRole.BACKER], kycStatus: KycStatus.VERIFIED });
    ctx.users.set("u2", { id: "u2", roles: [UserRole.BACKER], kycStatus: KycStatus.NONE });
    ctx.users.set("op", { id: "op", roles: [UserRole.OPERATOR], kycStatus: KycStatus.VERIFIED });
  });

  it("未实名用户不能发布", async () => {
    const res = await service.create("u2", validInput);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
    expect(ctx.needs.size).toBe(0);
  });

  it("标题过短被拒绝", async () => {
    const res = await service.create("u1", { ...validInput, title: "太短" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("标题");
  });

  it("痛点描述过短被拒绝", async () => {
    const res = await service.create("u1", { ...validInput, description: "想要个工具" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("痛点描述");
  });

  it("目标金额低于下限被拒绝", async () => {
    const res = await service.create("u1", { ...validInput, targetAmount: NEED_LIMITS.amountMin - 1n });
    expect(res.ok).toBe(false);
  });

  it("截止时间早于当前被拒绝", async () => {
    const res = await service.create("u1", {
      ...validInput,
      deadline: new Date(Date.now() - 1000),
    });
    expect(res.ok).toBe(false);
  });

  it("发布成功：进入征集期、写状态日志、自动授予发起者角色", async () => {
    const res = await service.create("u1", validInput);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.status).toBe(NeedStatus.COLLECTING);
    expect(res.value.publishedAt).not.toBeNull();
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0]?.toStatus).toBe(NeedStatus.COLLECTING);
    expect(ctx.users.get("u1")?.roles).toContain(UserRole.REQUESTER);
  });

  it("保存草稿不进入征集期", async () => {
    const res = await service.create("u1", validInput, { publish: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.status).toBe(NeedStatus.DRAFT);
    expect(res.value.publishedAt).toBeNull();
  });
});

describe("NeedService 状态流转（F06）", () => {
  let ctx: ReturnType<typeof makeDb>;
  let service: NeedService;
  let needId: string;

  beforeEach(async () => {
    ctx = makeDb();
    service = new NeedService(ctx.db as never);
    ctx.users.set("u1", { id: "u1", roles: [UserRole.REQUESTER], kycStatus: KycStatus.VERIFIED });
    ctx.users.set("u3", { id: "u3", roles: [UserRole.BACKER], kycStatus: KycStatus.VERIFIED });
    ctx.users.set("op", { id: "op", roles: [UserRole.OPERATOR], kycStatus: KycStatus.VERIFIED });
    const created = await service.create("u1", validInput, { publish: false });
    if (!created.ok) throw new Error("seed failed");
    needId = created.value.id;
  });

  it("发起者可以发布自己的草稿", async () => {
    const res = await service.transition("u1", needId, NeedStatus.COLLECTING, "发布");
    expect(res.ok).toBe(true);
    expect(ctx.needs.get(needId)?.status).toBe(NeedStatus.COLLECTING);
  });

  it("发起者不能跳级到竞标中", async () => {
    const res = await service.transition("u1", needId, NeedStatus.BIDDING);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
  });

  it("非发起者不能操作", async () => {
    const res = await service.transition("u3", needId, NeedStatus.COLLECTING);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
  });

  it("运营方可执行合法流转", async () => {
    await service.transition("u1", needId, NeedStatus.COLLECTING);
    const res = await service.transition("op", needId, NeedStatus.PLEDGING, "票数达标");
    expect(res.ok).toBe(true);
    expect(ctx.needs.get(needId)?.status).toBe(NeedStatus.PLEDGING);
  });

  it("运营方也不能执行非法流转", async () => {
    const res = await service.transition("op", needId, NeedStatus.COMPLETED);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_STATE");
  });

  it("每次流转都记录 from/to 与原因", async () => {
    await service.transition("u1", needId, NeedStatus.COLLECTING, "发布");
    const last = ctx.logs[ctx.logs.length - 1];
    expect(last?.fromStatus).toBe(NeedStatus.DRAFT);
    expect(last?.toStatus).toBe(NeedStatus.COLLECTING);
    expect(last?.reason).toBe("发布");
  });
});
