import { describe, it, expect, vi, beforeEach } from "vitest";
import { KycStatus, NeedMode, NeedStatus, UserRole } from "@prisma/client";
import { BountyService } from "@/domain/bounty/service";
import { ProposalService } from "@/domain/proposal/service";
import { makeFinanceDb } from "../helpers/finance-db";

vi.mock("@/domain/shared/audit", () => ({ writeAudit: vi.fn().mockResolvedValue({}) }));

function fakeGateway() {
  return {
    provider: "mock",
    freeze: vi.fn(async ({ reference }: { reference: string }) => ({
      ref: `mock-freeze-${reference}`,
    })),
    release: vi.fn(async ({ reference }: { reference: string }) => ({
      ref: `mock-release-${reference}`,
    })),
    refund: vi.fn(async ({ reference }: { reference: string }) => ({
      ref: `mock-refund-${reference}`,
    })),
  };
}

const AMOUNT = 200_000n; // 2000 元

function seed(mode: NeedMode = NeedMode.BOUNTY) {
  const ctx = makeFinanceDb();
  ctx.users.set("owner", {
    id: "owner",
    kycStatus: KycStatus.VERIFIED,
    roles: [UserRole.REQUESTER],
  });
  ctx.users.set("stranger", {
    id: "stranger",
    kycStatus: KycStatus.VERIFIED,
    roles: [UserRole.BACKER],
  });
  ctx.users.set("nokyc", { id: "nokyc", kycStatus: KycStatus.NONE, roles: [UserRole.REQUESTER] });
  ctx.users.set("dev", {
    id: "dev",
    kycStatus: KycStatus.VERIFIED,
    roles: [UserRole.BUILDER],
    nickname: "开发者甲",
  });
  ctx.needs.set("n1", {
    id: "n1",
    status: NeedStatus.DRAFT,
    mode,
    bountyAmount: AMOUNT,
    deadline: null,
    targetAmount: AMOUNT,
    pledgedAmount: 0n,
    requesterId: "owner",
    publishedAt: null,
  });
  return ctx;
}

describe("BountyService 悬赏预付（F28）", () => {
  let gateway: ReturnType<typeof fakeGateway>;

  beforeEach(() => {
    gateway = fakeGateway();
  });

  it("预付成功后进入方案征集，账本一借一贷", async () => {
    const ctx = seed();
    const service = new BountyService(ctx.db as never, gateway as never);

    const result = await service.deposit("owner", "n1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe(NeedStatus.BIDDING);
    expect(result.value.bountyAmount).toBe(AMOUNT.toString());
    expect(ctx.needs.get("n1")?.status).toBe(NeedStatus.BIDDING);
    expect(ctx.needs.get("n1")?.publishedAt).toBeTruthy();

    expect(ctx.escrows).toHaveLength(1);
    expect(ctx.escrows[0]?.status).toBe("HELD");

    const out = ctx.ledger.find((l) => l.direction === "DEBIT");
    const into = ctx.ledger.find((l) => l.direction === "CREDIT");
    expect(out?.accountType).toBe("BACKER");
    expect(out?.amount).toBe(AMOUNT);
    expect(into?.accountType).toBe("ESCROW");
    expect(into?.amount).toBe(AMOUNT);
    expect(ctx.ledger).toHaveLength(2);

    expect(ctx.orders).toHaveLength(1);
  });

  it("重复预付幂等，不重复托管与记账", async () => {
    const ctx = seed();
    const service = new BountyService(ctx.db as never, gateway as never);

    await service.deposit("owner", "n1");
    const second = await service.deposit("owner", "n1");

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.duplicated).toBe(true);
    expect(ctx.escrows).toHaveLength(1);
    expect(ctx.ledger).toHaveLength(2);
  });

  it("非悬赏模式拒绝预付", async () => {
    const ctx = seed(NeedMode.CROWDFUND);
    const service = new BountyService(ctx.db as never, gateway as never);
    const result = await service.deposit("owner", "n1");
    expect(result.ok).toBe(false);
    expect(ctx.ledger).toHaveLength(0);
  });

  it("非发起者不能替别人付悬赏", async () => {
    const ctx = seed();
    const service = new BountyService(ctx.db as never, gateway as never);
    const result = await service.deposit("stranger", "n1");
    expect(result.ok).toBe(false);
    expect(ctx.escrows).toHaveLength(0);
  });

  it("未实名不能支付悬赏", async () => {
    const ctx = seed();
    ctx.needs.set("n1", { ...ctx.needs.get("n1")!, requesterId: "nokyc" });
    const service = new BountyService(ctx.db as never, gateway as never);
    const result = await service.deposit("nokyc", "n1");
    expect(result.ok).toBe(false);
    expect(ctx.ledger).toHaveLength(0);
  });

  it("征集期撤回：托管全额退回，需求转已退款", async () => {
    const ctx = seed();
    const service = new BountyService(ctx.db as never, gateway as never);
    await service.deposit("owner", "n1");

    const refund = await service.cancelAndRefund("owner", "n1", "没人接");
    expect(refund.ok).toBe(true);
    if (!refund.ok) return;
    expect(refund.value.refunded).toBe(AMOUNT.toString());

    expect(ctx.needs.get("n1")?.status).toBe(NeedStatus.REFUNDED);
    expect(ctx.escrows[0]?.status).toBe("REFUNDED");
    // 预付 1 借 1 贷 + 退款 1 借 1 贷
    expect(ctx.ledger).toHaveLength(4);

    const escrowBalance = ctx.ledger
      .filter((l) => l.accountType === "ESCROW")
      .reduce((sum, l) => sum + (l.direction === "CREDIT" ? l.amount : -l.amount), 0n);
    expect(escrowBalance).toBe(0n);
  });

  it("重复撤回幂等，不再重复退款", async () => {
    const ctx = seed();
    const service = new BountyService(ctx.db as never, gateway as never);
    await service.deposit("owner", "n1");
    await service.cancelAndRefund("owner", "n1");

    const again = await service.cancelAndRefund("owner", "n1");
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.duplicated).toBe(true);
    expect(ctx.ledger).toHaveLength(4);
  });

  it("开发中终止：只退未放款部分", async () => {
    const ctx = seed();
    const service = new BountyService(ctx.db as never, gateway as never);
    await service.deposit("owner", "n1");

    ctx.needs.set("n1", { ...ctx.needs.get("n1")!, status: NeedStatus.IN_PROGRESS });
    ctx.projects.push({
      id: "pj1",
      needId: "n1",
      proposalId: "pr1",
      status: "IN_PROGRESS",
      totalAmount: AMOUNT,
      releasedAmount: 80_000n,
    });

    const refund = await service.cancelAndRefund("owner", "n1", "需求方终止");
    expect(refund.ok).toBe(true);
    if (!refund.ok) return;
    expect(refund.value.refunded).toBe((AMOUNT - 80_000n).toString());
    expect(ctx.needs.get("n1")?.status).toBe(NeedStatus.REFUNDED);
    expect(ctx.projects[0]?.status).toBe("REFUNDED");
  });
});

describe("悬赏模式选标（F28）", () => {
  it("项目托管总额取悬赏金，而不是承诺合计", async () => {
    const ctx = seed();
    ctx.needs.set("n1", {
      ...ctx.needs.get("n1")!,
      status: NeedStatus.BIDDING,
      pledgedAmount: 0n,
    });
    ctx.proposals.push({
      id: "pr1",
      needId: "n1",
      builderId: "dev",
      status: "SUBMITTED",
      quote: 150_000n,
      createdAt: new Date(),
    });

    const service = new ProposalService(ctx.db as never);
    const result = await service.select("owner", "n1", "pr1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.totalAmount).toBe(AMOUNT.toString());
    expect(ctx.projects[0]?.totalAmount).toBe(AMOUNT);
  });

  it("悬赏需求不允许支持者投票", async () => {
    const ctx = seed();
    ctx.needs.set("n1", { ...ctx.needs.get("n1")!, status: NeedStatus.BIDDING });
    ctx.pledges.push({
      id: "p1",
      userId: "stranger",
      needId: "n1",
      amount: 50_000n,
      status: "LOCKED",
      idempotencyKey: "k1",
      createdAt: new Date(),
    });
    ctx.proposals.push({
      id: "pr1",
      needId: "n1",
      builderId: "dev",
      status: "SUBMITTED",
      quote: 150_000n,
      createdAt: new Date(),
    });

    const service = new ProposalService(ctx.db as never);
    const result = await service.voteForProposal("stranger", "n1", "pr1");
    expect(result.ok).toBe(false);
    expect(ctx.proposalVotes).toHaveLength(0);
  });
});
