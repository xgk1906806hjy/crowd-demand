import { describe, it, expect, vi } from "vitest";
import { NeedStatus, PledgeStatus } from "@prisma/client";
import { expireOverdueNeeds, refundNeedPledges } from "@/domain/pledge/lifecycle";
import { MockPaymentGateway } from "@/infrastructure/payment/gateway";
import { makeFinanceDb } from "../helpers/finance-db";

vi.mock("@/domain/shared/audit", () => ({ writeAudit: vi.fn().mockResolvedValue({}) }));

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
const past = new Date(Date.now() - 24 * 3600 * 1000);

function seedPledges(ctx: ReturnType<typeof makeFinanceDb>) {
  ctx.needs.set("n1", {
    id: "n1",
    status: NeedStatus.PLEDGING,
    deadline: past,
    targetAmount: 100_000n,
    pledgedAmount: 7_400n,
  });
  ctx.pledges.push(
    {
      id: "p1",
      userId: "u1",
      needId: "n1",
      amount: 4_900n,
      status: PledgeStatus.LOCKED,
      idempotencyKey: "k1",
      createdAt: new Date(),
    },
    {
      id: "p2",
      userId: "u2",
      needId: "n1",
      amount: 2_500n,
      status: PledgeStatus.FROZEN,
      idempotencyKey: "k2",
      createdAt: new Date(),
    },
  );
}

describe("退款与到期结算（F11）", () => {
  it("全额退款：逐笔冲销托管，承诺置为已退款", async () => {
    const ctx = makeFinanceDb();
    seedPledges(ctx);

    const summary = await refundNeedPledges("n1", {
      db: ctx.db as never,
      gateway: new MockPaymentGateway(),
    });

    expect(summary.count).toBe(2);
    expect(summary.total).toBe(7_400n);
    expect(ctx.pledges.every((p) => p.status === PledgeStatus.REFUNDED)).toBe(true);
    // 每笔退款两条分录
    expect(ctx.ledger).toHaveLength(4);
    expect(ctx.orders).toHaveLength(2);
    expect(ctx.ledger.every((e) => e.bizType === "REFUND")).toBe(true);
  });

  it("到期未达标：流拍后全额退款，需求终态为已退款", async () => {
    const ctx = makeFinanceDb();
    seedPledges(ctx);

    const summary = await expireOverdueNeeds(new Date(), {
      db: ctx.db as never,
      gateway: new MockPaymentGateway(),
    });

    expect(summary.expiredNeeds).toBe(1);
    expect(summary.refundedPledges).toBe(2);
    expect(summary.refundedAmount).toBe("7400");
    expect(ctx.needs.get("n1")?.status).toBe(NeedStatus.REFUNDED);
    expect(ctx.logs.map((l) => l.toStatus)).toEqual([
      NeedStatus.FAILED,
      NeedStatus.REFUNDED,
    ]);
  });

  it("已达标的需求到期不流拍", async () => {
    const ctx = makeFinanceDb();
    ctx.needs.set("n1", {
      id: "n1",
      status: NeedStatus.PLEDGING,
      deadline: past,
      targetAmount: 1_000n,
      pledgedAmount: 1_000n,
    });

    const summary = await expireOverdueNeeds(new Date(), {
      db: ctx.db as never,
      gateway: new MockPaymentGateway(),
    });

    expect(summary.expiredNeeds).toBe(0);
    expect(ctx.needs.get("n1")?.status).toBe(NeedStatus.PLEDGING);
  });

  it("未到期的需求不处理", async () => {
    const ctx = makeFinanceDb();
    ctx.needs.set("n1", {
      id: "n1",
      status: NeedStatus.PLEDGING,
      deadline: future,
      targetAmount: 100_000n,
      pledgedAmount: 0n,
    });

    const summary = await expireOverdueNeeds(new Date(), {
      db: ctx.db as never,
      gateway: new MockPaymentGateway(),
    });

    expect(summary.expiredNeeds).toBe(0);
  });
});
