import { describe, it, expect, vi, beforeEach } from "vitest";
import { KycStatus, NeedStatus } from "@prisma/client";
import { VoteService } from "@/domain/vote/service";

vi.mock("@/domain/shared/audit", () => ({ writeAudit: vi.fn().mockResolvedValue({}) }));

type MemNeed = {
  id: string;
  status: NeedStatus;
  voteCount: number;
  voteThreshold: number;
};

function makeDb() {
  const users = new Map<string, { id: string; kycStatus: KycStatus }>();
  const needs = new Map<string, MemNeed>();
  const votes: Array<{ id: string; needId: string; userId: string }> = [];
  const logs: Array<Record<string, unknown>> = [];
  let vid = 0;

  const db = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null,
    },
    need: {
      findUnique: async ({ where }: { where: { id: string } }) => needs.get(where.id) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { voteCount?: { increment?: number; decrement?: number } };
      }) => {
        const n = needs.get(where.id);
        if (!n) throw new Error("need not found");
        if (data.voteCount?.increment) n.voteCount += data.voteCount.increment;
        if (data.voteCount?.decrement) n.voteCount -= data.voteCount.decrement;
        return { ...n };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status?: NeedStatus };
        data: { status?: NeedStatus };
      }) => {
        const n = needs.get(where.id);
        if (!n) return { count: 0 };
        if (where.status && n.status !== where.status) return { count: 0 };
        if (data.status) n.status = data.status;
        return { count: 1 };
      },
    },
    vote: {
      findUnique: async ({
        where,
      }: {
        where: { needId_userId: { needId: string; userId: string } };
      }) =>
        votes.find(
          (v) =>
            v.needId === where.needId_userId.needId && v.userId === where.needId_userId.userId,
        ) ?? null,
      create: async ({ data }: { data: { needId: string; userId: string } }) => {
        const v = { id: `v${++vid}`, ...data };
        votes.push(v);
        return v;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const i = votes.findIndex((v) => v.id === where.id);
        if (i >= 0) votes.splice(i, 1);
        return {};
      },
    },
    needStatusLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        logs.push(data);
        return { id: `l${logs.length}`, ...data };
      },
    },
    $transaction: async (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (tx: unknown) => Promise<unknown>)(db)
        : Promise.all(arg as Promise<unknown>[]),
  };

  return { db, users, needs, votes, logs };
}

describe("VoteService 投票（F07）", () => {
  let ctx: ReturnType<typeof makeDb>;
  let service: VoteService;

  beforeEach(() => {
    ctx = makeDb();
    service = new VoteService(ctx.db as never);
    ctx.users.set("u1", { id: "u1", kycStatus: KycStatus.VERIFIED });
    ctx.users.set("u2", { id: "u2", kycStatus: KycStatus.VERIFIED });
    ctx.users.set("uv", { id: "uv", kycStatus: KycStatus.NONE });
    ctx.needs.set("n1", { id: "n1", status: NeedStatus.COLLECTING, voteCount: 0, voteThreshold: 2 });
  });

  it("未实名用户不能投票", async () => {
    const res = await service.cast("uv", "n1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
    expect(ctx.needs.get("n1")?.voteCount).toBe(0);
  });

  it("投票后票数 +1", async () => {
    const res = await service.cast("u1", "n1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.voteCount).toBe(1);
      expect(res.value.voted).toBe(true);
    }
    expect(ctx.votes).toHaveLength(1);
  });

  it("同一用户重复投票幂等，不重复计数", async () => {
    await service.cast("u1", "n1");
    const res = await service.cast("u1", "n1");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.voteCount).toBe(1);
    expect(ctx.votes).toHaveLength(1);
  });

  it("达到门槛自动进入承诺期并写状态日志", async () => {
    await service.cast("u1", "n1");
    expect(ctx.needs.get("n1")?.status).toBe(NeedStatus.COLLECTING);

    const res = await service.cast("u2", "n1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.thresholdReached).toBe(true);
      expect(res.value.status).toBe(NeedStatus.PLEDGING);
    }
    expect(ctx.needs.get("n1")?.status).toBe(NeedStatus.PLEDGING);
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0]?.toStatus).toBe(NeedStatus.PLEDGING);
  });

  it("非征集期不可投票", async () => {
    ctx.needs.set("n2", { id: "n2", status: NeedStatus.PLEDGING, voteCount: 5, voteThreshold: 5 });
    const res = await service.cast("u1", "n2");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_STATE");
  });

  it("取消投票后票数回落", async () => {
    await service.cast("u1", "n1");
    const res = await service.cancel("u1", "n1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.voteCount).toBe(0);
      expect(res.value.voted).toBe(false);
    }
    expect(ctx.votes).toHaveLength(0);
  });

  it("未投票时取消幂等", async () => {
    const res = await service.cancel("u1", "n1");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.voteCount).toBe(0);
  });
});
