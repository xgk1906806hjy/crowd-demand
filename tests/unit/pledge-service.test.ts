import { describe, it, expect, vi, beforeEach } from "vitest";
import { KycStatus, NeedStatus, PledgeStatus } from "@prisma/client";
import { PledgeService } from "@/domain/pledge/service";
import { MockPaymentGateway } from "@/infrastructure/payment/gateway";
import { env } from "@/lib/env";
import { makeFinanceDb } from "../helpers/finance-db";

vi.mock("@/domain/shared/audit", () => ({ writeAudit: vi.fn().mockResolvedValue({}) }));

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);

function seed() {
  const ctx = makeFinanceDb();
  ctx.users.set("u1", { id: "u1", kycStatus: KycStatus.VERIFIED, nickname: "小王" });
  ctx.users.set("uv", { id: "uv", kycStatus: KycStatus.NONE });
  ctx.needs.set("n1", {
    id: "n1",
    status: NeedStatus.PLEDGING,
    deadline: future,
    targetAmount: 1_000_000n,
    pledgedAmount: 0n,
  });
  const service = new PledgeService(ctx.db as never, new MockPaymentGateway());
  return { ctx, service };
}

describe("PledgeService 付费承诺（F09）", () => {
  let ctx: ReturnType<typeof seed>["ctx"];
  let service: PledgeService;

  beforeEach(() => {
    const s = seed();
    ctx = s.ctx;
    service = s.service;
  });

  it("未实名不能承诺", async () => {
    const res = await service.pledge("uv", "n1", { amount: 4_900n });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
    expect(ctx.pledges).toHaveLength(0);
  });

  it("非承诺中状态不能承诺", async () => {
    const n = ctx.needs.get("n1");
    if (n) n.status = NeedStatus.COLLECTING;
    const res = await service.pledge("u1", "n1", { amount: 4_900n });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_STATE");
  });

  it("截止后不能承诺", async () => {
    const n = ctx.needs.get("n1");
    if (n) n.deadline = new Date(Date.now() - 1000);
    const res = await service.pledge("u1", "n1", { amount: 4_900n });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_STATE");
  });

  it("低于最低金额被拒绝", async () => {
    const res = await service.pledge("u1", "n1", { amount: 500n });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("超过单笔上限被拒绝", async () => {
    const over = BigInt(env.MAX_PLEDGE_AMOUNT_CENTS) + 1n;
    const res = await service.pledge("u1", "n1", { amount: over });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("承诺成功：写承诺、双分录账本、支付单，并更新需求金额", async () => {
    const res = await service.pledge("u1", "n1", { amount: 4_900n });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.pledgedAmount).toBe("4900");
      expect(res.value.progress).toBe(0.5);
      expect(res.value.needStatus).toBe(NeedStatus.PLEDGING);
      expect(res.value.funded).toBe(false);
    }

    expect(ctx.pledges).toHaveLength(1);
    expect(ctx.pledges[0]?.status).toBe(PledgeStatus.FROZEN);
    expect(ctx.ledger).toHaveLength(2);
    expect(ctx.orders).toHaveLength(1);
    expect(ctx.needs.get("n1")?.pledgedAmount).toBe(4_900n);
  });

  it("相同幂等键重复提交不重复扣款", async () => {
    const first = await service.pledge("u1", "n1", { amount: 4_900n, idempotencyKey: "k-fixed" });
    const second = await service.pledge("u1", "n1", { amount: 4_900n, idempotencyKey: "k-fixed" });

    expect(first.ok && second.ok).toBe(true);
    expect(ctx.pledges).toHaveLength(1);
    expect(ctx.ledger).toHaveLength(2);
    expect(ctx.needs.get("n1")?.pledgedAmount).toBe(4_900n);
  });

  it("达到目标金额：锁定承诺并进入竞标", async () => {
    const n = ctx.needs.get("n1");
    if (n) n.targetAmount = 10_000n;

    const res = await service.pledge("u1", "n1", { amount: 10_000n });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.funded).toBe(true);
      expect(res.value.needStatus).toBe(NeedStatus.BIDDING);
      expect(res.value.progress).toBe(100);
    }
    expect(ctx.needs.get("n1")?.status).toBe(NeedStatus.BIDDING);
    expect(ctx.pledges[0]?.status).toBe(PledgeStatus.LOCKED);
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0]?.toStatus).toBe(NeedStatus.BIDDING);
  });

  it("公开列表不暴露手机号，只显示昵称兜底", async () => {
    await service.pledge("u1", "n1", { amount: 4_900n });
    const res = await service.listByNeed("n1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.items[0]?.backerName).toBe("小王");
      expect(res.value.total).toBe("4900");
    }
  });
});
