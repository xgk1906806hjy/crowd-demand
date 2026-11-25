import { describe, it, expect, vi, beforeEach } from "vitest";
import { KycStatus, NeedMode, NeedStatus, ProposalStatus, UserRole } from "@prisma/client";
import { ProposalService } from "@/domain/proposal/service";
import { makeFinanceDb } from "../helpers/finance-db";

vi.mock("@/domain/shared/audit", () => ({ writeAudit: vi.fn().mockResolvedValue({}) }));

const valid = {
  understanding: "这是一个把会议通知自动整理为日程的需求，核心用户是经常开线上会的小团队。",
  spec: "使用网页工具实现：解析粘贴的通知文本，提取时间、参与人、议题，生成 ICS 日历文件并支持导出到主流日历，含冲突提示与提醒设置。",
  quote: 50_000n,
  durationDays: 14,
  pastCases: "做过类似的文本解析工具",
};

function seed() {
  const ctx = makeFinanceDb();
  ctx.users.set("owner", { id: "owner", kycStatus: KycStatus.VERIFIED, roles: [UserRole.REQUESTER] });
  ctx.users.set("b1", {
    id: "b1",
    kycStatus: KycStatus.VERIFIED,
    roles: [UserRole.BUILDER],
    nickname: "开发者甲",
    reputationScore: 80,
  });
  ctx.users.set("b2", {
    id: "b2",
    kycStatus: KycStatus.VERIFIED,
    roles: [UserRole.BUILDER],
    nickname: "开发者乙",
    reputationScore: 60,
  });
  ctx.users.set("plain", { id: "plain", kycStatus: KycStatus.VERIFIED, roles: [UserRole.BACKER] });
  ctx.users.set("builderNoKyc", {
    id: "builderNoKyc",
    kycStatus: KycStatus.NONE,
    roles: [UserRole.BUILDER],
  });
  ctx.needs.set("n1", {
    id: "n1",
    status: NeedStatus.BIDDING,
    deadline: new Date(Date.now() + 86400000),
    targetAmount: 100_000n,
    pledgedAmount: 100_000n,
    requesterId: "owner",
  });
  return { ctx, service: new ProposalService(ctx.db as never) };
}

describe("ProposalService 提案提交（F12）", () => {
  let ctx: ReturnType<typeof seed>["ctx"];
  let service: ProposalService;

  beforeEach(() => {
    const s = seed();
    ctx = s.ctx;
    service = s.service;
  });

  it("非开发者角色也可提交（不再限制角色）", async () => {
    const res = await service.submit("plain", "n1", valid);
    expect(res.ok).toBe(true);
    expect(ctx.proposals).toHaveLength(1);
  });

  it("无偿需求（OPEN）未实名也可提交方案", async () => {
    ctx.needs.set("n2", {
      id: "n2",
      status: NeedStatus.BIDDING,
      mode: NeedMode.OPEN,
      deadline: new Date(Date.now() + 86400000),
      targetAmount: 0n,
      pledgedAmount: 0n,
      bountyAmount: 0n,
      requesterId: "owner",
    });
    const res = await service.submit("builderNoKyc", "n2", { ...valid, quote: 0n });
    expect(res.ok).toBe(true);
  });

  it("开发者未实名不能提交", async () => {
    const res = await service.submit("builderNoKyc", "n1", valid);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
  });

  it("非竞标期不能提交", async () => {
    const n = ctx.needs.get("n1");
    if (n) n.status = NeedStatus.PLEDGING;
    const res = await service.submit("b1", "n1", valid);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_STATE");
  });

  it("规格过短被拒绝", async () => {
    const res = await service.submit("b1", "n1", { ...valid, spec: "做个网页" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("报价超过托管总额被拒绝", async () => {
    const res = await service.submit("b1", "n1", { ...valid, quote: 100_001n });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("同一开发者重复提交返回冲突", async () => {
    await service.submit("b1", "n1", valid);
    const res = await service.submit("b1", "n1", valid);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
    expect(ctx.proposals).toHaveLength(1);
  });

  it("提交成功状态为待选", async () => {
    const res = await service.submit("b1", "n1", valid);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.status).toBe(ProposalStatus.SUBMITTED);
    expect(ctx.proposals).toHaveLength(1);
  });
});

describe("ProposalService 选标（F13）", () => {
  let ctx: ReturnType<typeof seed>["ctx"];
  let service: ProposalService;

  beforeEach(async () => {
    const s = seed();
    ctx = s.ctx;
    service = s.service;
    await service.submit("b1", "n1", valid);
    await service.submit("b2", "n1", { ...valid, quote: 60_000n });
  });

  it("非发起者不能选标", async () => {
    const target = ctx.proposals[0]?.id as string;
    const res = await service.select("b2", "n1", target);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
  });

  it("选标成功：项目生成、需求转开发中、其余提案驳回", async () => {
    const target = ctx.proposals[0]?.id as string;
    const res = await service.select("owner", "n1", target);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.totalAmount).toBe("100000");

    expect(ctx.needs.get("n1")?.status).toBe(NeedStatus.IN_PROGRESS);
    expect(ctx.projects).toHaveLength(1);
    const statuses = ctx.proposals.map((p) => p.status);
    expect(statuses).toContain(ProposalStatus.SELECTED);
    expect(statuses).toContain(ProposalStatus.REJECTED);
    expect(ctx.logs).toHaveLength(1);
    expect(ctx.logs[0]?.toStatus).toBe(NeedStatus.IN_PROGRESS);
  });

  it("重复选标被拒绝", async () => {
    const target = ctx.proposals[0]?.id as string;
    await service.select("owner", "n1", target);
    const again = await service.select("owner", "n1", ctx.proposals[1]?.id as string);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("INVALID_STATE");
  });

  it("提案不属于该需求时返回不存在", async () => {
    const res = await service.select("owner", "n1", "not-exist");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });
});

describe("ProposalService 支持者选标投票（F13）", () => {
  let ctx: ReturnType<typeof seed>["ctx"];
  let service: ProposalService;

  function addPledge(userId: string, amount: bigint, status = "LOCKED") {
    ctx.pledges.push({
      id: `pledge-${userId}-${ctx.pledges.length}`,
      userId,
      needId: "n1",
      amount,
      status,
      idempotencyKey: `k-${userId}-${ctx.pledges.length}`,
      createdAt: new Date(),
    });
  }

  beforeEach(async () => {
    const s = seed();
    ctx = s.ctx;
    service = s.service;
    await service.submit("b1", "n1", valid);
    await service.submit("b2", "n1", { ...valid, quote: 60_000n });
    ctx.users.set("backer1", { id: "backer1", kycStatus: KycStatus.VERIFIED, roles: [UserRole.BACKER] });
    ctx.users.set("backer2", { id: "backer2", kycStatus: KycStatus.VERIFIED, roles: [UserRole.BACKER] });
    addPledge("backer1", 30_000n);
    addPledge("backer2", 70_000n);
  });

  it("未付订金的用户不能投票", async () => {
    const res = await service.voteForProposal("plain", "n1", ctx.proposals[0]?.id as string);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
    expect(ctx.proposalVotes).toHaveLength(0);
  });

  it("投票权重等于有效承诺金额合计", async () => {
    addPledge("backer1", 5_000n);
    const res = await service.voteForProposal("backer1", "n1", ctx.proposals[0]?.id as string);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.weight).toBe("35000");
    expect(ctx.proposalVotes).toHaveLength(1);
    expect(ctx.proposalVotes[0]?.weight).toBe(35_000n);
  });

  it("重复投同一提案幂等，不产生第二票", async () => {
    const pid = ctx.proposals[0]?.id as string;
    await service.voteForProposal("backer1", "n1", pid);
    const again = await service.voteForProposal("backer1", "n1", pid);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.value.changed).toBe(false);
    expect(ctx.proposalVotes).toHaveLength(1);
  });

  it("改投其他提案：旧票被撤，一人一票", async () => {
    const first = ctx.proposals[0]?.id as string;
    const second = ctx.proposals[1]?.id as string;
    await service.voteForProposal("backer1", "n1", first);
    const res = await service.voteForProposal("backer1", "n1", second);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.changed).toBe(true);
    expect(ctx.proposalVotes).toHaveLength(1);
    expect(ctx.proposalVotes[0]?.proposalId).toBe(second);
  });

  it("非竞标期不能投票", async () => {
    const n = ctx.needs.get("n1");
    if (n) n.status = NeedStatus.PLEDGING;
    const res = await service.voteForProposal("backer1", "n1", ctx.proposals[0]?.id as string);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_STATE");
  });

  it("提案不属于该需求返回不存在", async () => {
    const res = await service.voteForProposal("backer1", "n1", "not-exist");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");
  });

  it("列表返回加权票数与人数", async () => {
    await service.voteForProposal("backer1", "n1", ctx.proposals[0]?.id as string);
    await service.voteForProposal("backer2", "n1", ctx.proposals[0]?.id as string);
    const res = await service.listByNeed("n1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      const target = res.value.items.find((p) => p.id === ctx.proposals[0]?.id);
      expect(target?.voteWeight).toBe("100000");
      expect(target?.voteCount).toBe(2);
    }
  });

  it("viewerSelection 返回已投提案与票权", async () => {
    const pid = ctx.proposals[0]?.id as string;
    await service.voteForProposal("backer1", "n1", pid);
    const view = await service.viewerSelection("backer1", "n1");
    expect(view.proposalId).toBe(pid);
    expect(view.weight).toBe("30000");

    const none = await service.viewerSelection("plain", "n1");
    expect(none.proposalId).toBeNull();
    expect(none.weight).toBe("0");
  });
});

describe("ProposalService 报价上限按需求模式（F28）", () => {
  let ctx: ReturnType<typeof seed>["ctx"];
  let service: ProposalService;

  beforeEach(() => {
    const s = seed();
    ctx = s.ctx;
    service = s.service;
  });

  it("悬赏需求报价不得超过悬赏金额", async () => {
    const n = ctx.needs.get("n1");
    if (n) {
      n.mode = "BOUNTY";
      n.bountyAmount = 100_000n;
      n.pledgedAmount = 0n;
    }
    const res = await service.submit("b1", "n1", { ...valid, quote: 100_001n });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("VALIDATION");
      expect(res.error).toContain("悬赏金额");
    }
  });

  it("悬赏需求在悬赏额度内可提交方案", async () => {
    const n = ctx.needs.get("n1");
    if (n) {
      n.mode = "BOUNTY";
      n.bountyAmount = 100_000n;
      n.pledgedAmount = 0n;
    }
    const res = await service.submit("b1", "n1", valid);
    expect(res.ok).toBe(true);
  });

  it("无偿需求只能零报价", async () => {
    const n = ctx.needs.get("n1");
    if (n) {
      n.mode = "OPEN";
      n.bountyAmount = 0n;
      n.pledgedAmount = 0n;
    }
    const bad = await service.submit("b1", "n1", { ...valid, quote: 1n });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("VALIDATION");

    const good = await service.submit("b1", "n1", { ...valid, quote: 0n });
    expect(good.ok).toBe(true);
  });
});
