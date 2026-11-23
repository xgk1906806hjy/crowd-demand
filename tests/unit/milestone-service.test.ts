import { describe, it, expect, vi, beforeEach } from "vitest";
import { KycStatus, MilestoneStatus, NeedStatus, PledgeStatus, ProposalStatus, UserRole } from "@prisma/client";
import { MilestoneService } from "@/domain/milestone/service";
import { makeFinanceDb } from "../helpers/finance-db";

vi.mock("@/domain/shared/audit", () => ({ writeAudit: vi.fn().mockResolvedValue({}) }));

const items = [
  { title: "原型确认", deliverable: "可交互原型与方案文档，确认核心流程与验收标准", releaseRatio: 5000 },
  { title: "开发上线", deliverable: "功能开发完成并部署上线，交付源码与使用说明", releaseRatio: 5000 },
];

function seed() {
  const ctx = makeFinanceDb();
  ctx.users.set("owner", { id: "owner", kycStatus: KycStatus.VERIFIED, roles: [UserRole.REQUESTER] });
  ctx.users.set("builder", {
    id: "builder",
    kycStatus: KycStatus.VERIFIED,
    roles: [UserRole.BUILDER],
    nickname: "开发者甲",
    reputationScore: 80,
  });
  ctx.users.set("stranger", { id: "stranger", kycStatus: KycStatus.VERIFIED, roles: [UserRole.BACKER] });
  ctx.users.set("u1", { id: "u1", kycStatus: KycStatus.VERIFIED, nickname: "支持者一" });
  ctx.users.set("u2", { id: "u2", kycStatus: KycStatus.VERIFIED, nickname: "支持者二" });

  ctx.needs.set("n1", {
    id: "n1",
    status: NeedStatus.IN_PROGRESS,
    deadline: null,
    targetAmount: 100_000n,
    pledgedAmount: 100_000n,
    requesterId: "owner",
  });
  ctx.proposals.push({
    id: "pr1",
    needId: "n1",
    builderId: "builder",
    quote: 80_000n,
    status: ProposalStatus.SELECTED,
    understanding: "理解",
    spec: "规格",
    durationDays: 30,
    createdAt: new Date(),
  });
  ctx.projects.push({
    id: "pj1",
    needId: "n1",
    proposalId: "pr1",
    status: "IN_PROGRESS",
    totalAmount: 100_000n,
    releasedAmount: 0n,
  });
  ctx.pledges.push(
    {
      id: "p1",
      userId: "u1",
      needId: "n1",
      amount: 60_000n,
      status: PledgeStatus.LOCKED,
      idempotencyKey: "k1",
      createdAt: new Date(),
    },
    {
      id: "p2",
      userId: "u2",
      needId: "n1",
      amount: 40_000n,
      status: PledgeStatus.LOCKED,
      idempotencyKey: "k2",
      createdAt: new Date(),
    },
  );

  return { ctx, service: new MilestoneService(ctx.db as never) };
}

describe("MilestoneService 拆分与提交（F14）", () => {
  let ctx: ReturnType<typeof seed>["ctx"];
  let service: MilestoneService;

  beforeEach(() => {
    const s = seed();
    ctx = s.ctx;
    service = s.service;
  });

  it("非中标开发者不能拆分里程碑", async () => {
    const res = await service.plan("stranger", "pj1", items);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
  });

  it("比例合计不等于 100% 被拒绝", async () => {
    const res = await service.plan("builder", "pj1", [
      { ...items[0]!, releaseRatio: 3000 },
      { ...items[1]!, releaseRatio: 3000 },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("拆分成功：金额以报价为基数，合计等于报价", async () => {
    const res = await service.plan("builder", "pj1", items);
    expect(res.ok).toBe(true);
    expect(ctx.milestones).toHaveLength(2);
    const total = ctx.milestones.reduce((sum, m) => sum + (m.releaseAmount as bigint), 0n);
    expect(total).toBe(80_000n);
    expect(ctx.milestones.map((m) => m.releaseAmount)).toEqual([40_000n, 40_000n]);
  });

  it("重复拆分被拒绝", async () => {
    await service.plan("builder", "pj1", items);
    const res = await service.plan("builder", "pj1", items);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
  });

  it("提交交付物：节点转待验收，需求进入验收中", async () => {
    await service.plan("builder", "pj1", items);
    const milestoneId = ctx.milestones[0]?.id as string;

    const res = await service.submit("builder", milestoneId, "原型链接：https://example.com");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.status).toBe(MilestoneStatus.SUBMITTED);
    expect(ctx.needs.get("n1")?.status).toBe(NeedStatus.ACCEPTING);
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0]?.toStatus).toBe(NeedStatus.ACCEPTING);
  });

  it("非中标开发者不能提交", async () => {
    await service.plan("builder", "pj1", items);
    const res = await service.submit("stranger", ctx.milestones[0]?.id as string, "");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
  });
});

describe("验收放款与结算（F15/F16/F17）", () => {
  let ctx: ReturnType<typeof seed>["ctx"];
  let service: MilestoneService;

  beforeEach(async () => {
    const s = seed();
    ctx = s.ctx;
    service = s.service;
    await service.plan("builder", "pj1", items);
  });

  it("非发起者不能验收", async () => {
    const id = ctx.milestones[0]?.id as string;
    await service.submit("builder", id, "");
    const res = await service.accept("stranger", id);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
  });

  it("未提交的节点不能验收", async () => {
    const res = await service.accept("owner", ctx.milestones[0]?.id as string);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_STATE");
  });

  it("验收第一个节点：托管放款、写 Payout、项目已放款累加", async () => {
    const id = ctx.milestones[0]?.id as string;
    await service.submit("builder", id, "");
    const res = await service.accept("owner", id);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.released).toBe("40000");
      expect(res.value.projectCompleted).toBe(false);
    }
    expect(ctx.milestones[0]?.status).toBe(MilestoneStatus.RELEASED);
    expect(ctx.payouts).toHaveLength(1);
    expect(ctx.ledger).toHaveLength(2);
    expect(ctx.projects[0]?.releasedAmount).toBe(40_000n);
    expect(ctx.needs.get("n1")?.status).toBe(NeedStatus.ACCEPTING);
  });

  it("最后一个节点验收后结算：需求完成、超出报价部分按比例退回", async () => {
    const first = ctx.milestones[0]?.id as string;
    const last = ctx.milestones[1]?.id as string;
    await service.submit("builder", first, "");
    await service.accept("owner", first);
    await service.submit("builder", last, "");
    const res = await service.accept("owner", last);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.projectCompleted).toBe(true);
      expect(res.value.refunded).toBe("20000");
    }

    expect(ctx.projects[0]?.status).toBe("COMPLETED");
    expect(ctx.needs.get("n1")?.status).toBe(NeedStatus.COMPLETED);
    expect(ctx.pledges.every((p) => p.status === PledgeStatus.RELEASED)).toBe(true);

    // 退款：60000:40000 → 12000 / 8000
    const refunds = ctx.ledger.filter((e) => e.bizType === "REFUND" && e.direction === "CREDIT");
    expect(refunds.map((r) => r.amount).sort((a, b) => Number(a - b))).toEqual([8_000n, 12_000n]);

    const completedLog = ctx.logs.find((l) => l.toStatus === NeedStatus.COMPLETED);
    expect(completedLog).toBeTruthy();
  });

  it("报价等于托管额时不产生退款", async () => {
    const pr = ctx.proposals[0];
    if (pr) pr.quote = 100_000n;
    // 重新拆分（清空旧节点）
    ctx.milestones.length = 0;
    await service.plan("builder", "pj1", items);

    for (const m of [...ctx.milestones]) {
      await service.submit("builder", m.id as string, "");
      await service.accept("owner", m.id as string);
    }

    expect(ctx.ledger.filter((e) => e.bizType === "REFUND")).toHaveLength(0);
    expect(ctx.needs.get("n1")?.status).toBe(NeedStatus.COMPLETED);
  });
});
