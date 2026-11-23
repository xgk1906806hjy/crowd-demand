import { describe, it, expect, vi, beforeEach } from "vitest";
import { KycStatus, NeedStatus, ProposalStatus, UserRole } from "@prisma/client";
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

  it("非开发者角色不能提交", async () => {
    const res = await service.submit("plain", "n1", valid);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
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
