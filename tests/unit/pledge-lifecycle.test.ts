import { describe, it, expect, vi } from "vitest";
import { NeedStatus, PledgeStatus } from "@prisma/client";
import { expireOverdueNeeds, failNeedAndRefund, refundNeedPledges } from "@/domain/pledge/lifecycle";
import { MockPaymentGateway, type PaymentGateway } from "@/infrastructure/payment/gateway";
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

  // 承诺对应的托管入账，保证退款时托管账户有余额可退
  ctx.ledger.push(
    {
      id: "seed-escrow",
      accountType: "ESCROW",
      accountId: "ESCROW",
      direction: "CREDIT",
      amount: 7_400n,
      balanceAfter: 7_400n,
      bizType: "PLEDGE",
      bizId: "seed",
      idempotencyKey: "seed:in",
      createdAt: new Date(),
    },
    {
      id: "seed-backer",
      accountType: "BACKER",
      accountId: "u1",
      direction: "DEBIT",
      amount: 7_400n,
      balanceAfter: -7_400n,
      bizType: "PLEDGE",
      bizId: "seed",
      idempotencyKey: "seed:out",
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
    expect(summary.failed).toBe(0);
    expect(ctx.pledges.every((p) => p.status === PledgeStatus.REFUNDED)).toBe(true);
    // 每笔退款两条分录
    const refundEntries = ctx.ledger.filter((e) => e.bizType === "REFUND");
    expect(refundEntries).toHaveLength(4);
    expect(ctx.orders).toHaveLength(2);
    expect(ctx.orders.every((o) => o.gateway === "mock")).toBe(true);
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

describe("流拍退款兜底（F11）", () => {
  it("竞标中需求被终止：全额退款并进入已退款", async () => {
    const ctx = makeFinanceDb();
    seedPledges(ctx);
    const need = ctx.needs.get("n1");
    if (need) need.status = NeedStatus.BIDDING;

    const res = await failNeedAndRefund("n1", {
      db: ctx.db as never,
      gateway: new MockPaymentGateway(),
      reason: "运营方终止",
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.status).toBe(NeedStatus.REFUNDED);
      expect(res.value.refunded.count).toBe(2);
    }
    expect(ctx.pledges.every((p) => p.status === PledgeStatus.REFUNDED)).toBe(true);
    expect(ctx.ledger.filter((e) => e.bizType === "REFUND")).toHaveLength(4);
    expect(ctx.logs.map((l) => l.toStatus)).toEqual([NeedStatus.FAILED, NeedStatus.REFUNDED]);
  });

  it("开发中需求不能直接流拍退款", async () => {
    const ctx = makeFinanceDb();
    seedPledges(ctx);
    const need = ctx.needs.get("n1");
    if (need) need.status = NeedStatus.IN_PROGRESS;

    const res = await failNeedAndRefund("n1", {
      db: ctx.db as never,
      gateway: new MockPaymentGateway(),
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_STATE");
    expect(ctx.needs.get("n1")?.status).toBe(NeedStatus.IN_PROGRESS);
    expect(ctx.ledger.filter((e) => e.bizType === "REFUND")).toHaveLength(0);
  });

  it("外部退款失败：需求停在已流拍，承诺保持锁定，便于重试", async () => {
    const ctx = makeFinanceDb();
    seedPledges(ctx);
    const need = ctx.needs.get("n1");
    if (need) need.status = NeedStatus.BIDDING;

    const broken: PaymentGateway = {
      provider: "broken",
      freeze: async () => {
        throw new Error("gateway down");
      },
      release: async () => {
        throw new Error("gateway down");
      },
      refund: async () => {
        throw new Error("gateway down");
      },
    };

    const res = await failNeedAndRefund("n1", { db: ctx.db as never, gateway: broken });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("SERVICE_UNAVAILABLE");
    expect(ctx.needs.get("n1")?.status).toBe(NeedStatus.FAILED);
    expect(ctx.pledges.every((p) => p.status !== PledgeStatus.REFUNDED)).toBe(true);
    expect(ctx.ledger.filter((e) => e.bizType === "REFUND")).toHaveLength(0);
  });
});
