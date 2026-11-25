import {
  KycStatus,
  NeedMode,
  NeedStatus,
  PledgeStatus,
  ProposalStatus,
  UserRole,
} from "@prisma/client";
import { prisma } from "@/infrastructure/prisma/client";
import { writeAudit } from "@/domain/shared/audit";
import { ok, err, DomainError, type Result } from "@/domain/shared/result";
import { NEED_STATUS_LABEL } from "@/domain/need/state-machine";
import { transitionNeedInTx } from "@/domain/need/transition";

export const PROPOSAL_LIMITS = {
  understandingMin: 30,
  understandingMax: 2000,
  specMin: 50,
  specMax: 10_000,
  durationMin: 1,
  durationMax: 365,
  pastCasesMax: 2000,
} as const;

export interface SubmitProposalInput {
  understanding: string;
  spec: string;
  quote: bigint;
  durationDays: number;
  pastCases?: string | null;
}

export interface ProposalView {
  id: string;
  builderId: string;
  builderName: string;
  builderReputation: number;
  understanding: string;
  spec: string;
  quote: string;
  durationDays: number;
  pastCases: string | null;
  status: ProposalStatus;
  createdAt: string;
  /** 支持者投票权重合计（分，按承诺金额加权） */
  voteWeight: string;
  /** 投票支持者人数 */
  voteCount: number;
}

function len(s: string): number {
  return Array.from(s.trim()).length;
}

/** 选中冲突：并发选标时事务回滚用。 */
class SelectionConflict extends Error {}

export class ProposalService {
  constructor(private readonly db: typeof prisma = prisma) {}

  /** 提交提案（F12）。 */
  async submit(
    builderId: string,
    needId: string,
    input: SubmitProposalInput,
  ): Promise<Result<{ id: string; status: ProposalStatus }>> {
    const user = await this.db.user.findUnique({
      where: { id: builderId },
      select: { id: true, kycStatus: true },
    });
    if (!user) return err("用户不存在", DomainError.NOT_FOUND);

    const need = await this.db.need.findUnique({
      where: { id: needId },
      select: { id: true, status: true, mode: true, bountyAmount: true, pledgedAmount: true },
    });
    if (!need) return err("需求不存在", DomainError.NOT_FOUND);
    // 2026-11-24 调整：不再要求开发者角色；无资金需求（OPEN）不要求实名，
    // 涉及资金（悬赏/众筹）仍强制实名（AGENTS.md 资金合规红线）。
    if (need.mode !== NeedMode.OPEN && user.kycStatus !== KycStatus.VERIFIED) {
      return err("涉及资金的需求，提交方案前需完成实名认证", DomainError.FORBIDDEN);
    }
    if (need.status !== NeedStatus.BIDDING) {
      return err(
        `当前状态为「${NEED_STATUS_LABEL[need.status]}」，仅竞标中可提交提案`,
        DomainError.INVALID_STATE,
      );
    }

    const existing = await this.db.proposal.findUnique({
      where: { needId_builderId: { needId, builderId } },
      select: { id: true },
    });
    if (existing) {
      return err("你已对该需求提交过提案，可在「我的提案」中查看", DomainError.CONFLICT);
    }

    const understanding = input.understanding.trim();
    const spec = input.spec.trim();
    const pastCases = input.pastCases?.trim() || null;

    if (
      len(understanding) < PROPOSAL_LIMITS.understandingMin ||
      len(understanding) > PROPOSAL_LIMITS.understandingMax
    ) {
      return err(
        `需求理解需为 ${PROPOSAL_LIMITS.understandingMin}-${PROPOSAL_LIMITS.understandingMax} 字`,
        DomainError.VALIDATION,
      );
    }
    if (len(spec) < PROPOSAL_LIMITS.specMin || len(spec) > PROPOSAL_LIMITS.specMax) {
      return err(
        `可执行规格需为 ${PROPOSAL_LIMITS.specMin}-${PROPOSAL_LIMITS.specMax} 字`,
        DomainError.VALIDATION,
      );
    }
    if (pastCases && len(pastCases) > PROPOSAL_LIMITS.pastCasesMax) {
      return err(`过往案例不得超过 ${PROPOSAL_LIMITS.pastCasesMax} 字`, DomainError.VALIDATION);
    }
    if (
      !Number.isInteger(input.durationDays) ||
      input.durationDays < PROPOSAL_LIMITS.durationMin ||
      input.durationDays > PROPOSAL_LIMITS.durationMax
    ) {
      return err(
        `工期需为 ${PROPOSAL_LIMITS.durationMin}-${PROPOSAL_LIMITS.durationMax} 天`,
        DomainError.VALIDATION,
      );
    }
    // 报价上限按模式取：悬赏不超过悬赏金，众筹不超过已托管承诺总额，无偿固定 0
    const ceiling =
      need.mode === NeedMode.BOUNTY
        ? need.bountyAmount
        : need.mode === NeedMode.OPEN
          ? 0n
          : need.pledgedAmount;
    if (need.mode === NeedMode.OPEN) {
      if (input.quote < 0n) {
        return err("无偿需求的报价必须为 0", DomainError.VALIDATION);
      }
    } else if (input.quote <= 0n) {
      return err("报价必须大于 0", DomainError.VALIDATION);
    }
    if (input.quote > ceiling) {
      return err(
        need.mode === NeedMode.BOUNTY ? "报价不得超过悬赏金额" : "报价不得超过该需求已托管的承诺总额",
        DomainError.VALIDATION,
      );
    }

    const proposal = await this.db.proposal.create({
      data: {
        needId,
        builderId,
        understanding,
        spec,
        quote: input.quote,
        durationDays: input.durationDays,
        pastCases,
        status: ProposalStatus.SUBMITTED,
      },
      select: { id: true, status: true },
    });

    await writeAudit({
      action: "PROPOSAL",
      actorId: builderId,
      target: `need:${needId}`,
      detail: { event: "PROPOSAL_SUBMITTED", proposalId: proposal.id, quote: input.quote.toString() },
    });

    return ok({ id: proposal.id, status: proposal.status });
  }

  /** 某需求的提案列表（F12/F13）。 */
  async listByNeed(needId: string): Promise<Result<{ items: ProposalView[] }>> {
    const need = await this.db.need.findUnique({
      where: { id: needId },
      select: { id: true, status: true },
    });
    if (!need) return err("需求不存在", DomainError.NOT_FOUND);

    // 提案在竞标开始后才公开
    if (
      need.status !== NeedStatus.BIDDING &&
      need.status !== NeedStatus.IN_PROGRESS &&
      need.status !== NeedStatus.ACCEPTING &&
      need.status !== NeedStatus.COMPLETED
    ) {
      return ok({ items: [] });
    }

    const rows = await this.db.proposal.findMany({
      where: { needId },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        builderId: true,
        understanding: true,
        spec: true,
        quote: true,
        durationDays: true,
        pastCases: true,
        status: true,
        createdAt: true,
        builder: { select: { nickname: true, reputationScore: true } },
        votes: { select: { weight: true } },
      },
    });

    return ok({
      items: rows.map((r) => ({
        id: r.id,
        builderId: r.builderId,
        builderName: r.builder.nickname ?? "匿名开发者",
        builderReputation: r.builder.reputationScore,
        understanding: r.understanding,
        spec: r.spec,
        quote: r.quote.toString(),
        durationDays: r.durationDays,
        pastCases: r.pastCases,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        voteWeight: r.votes.reduce((sum, v) => sum + v.weight, 0n).toString(),
        voteCount: r.votes.length,
      })),
    });
  }

  /** 我的提案（开发者控制台）。 */
  async listMine(builderId: string): Promise<Result<{ items: Array<Record<string, unknown>> }>> {
    const rows = await this.db.proposal.findMany({
      where: { builderId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        quote: true,
        durationDays: true,
        status: true,
        createdAt: true,
        need: { select: { id: true, title: true, status: true } },
      },
    });

    return ok({
      items: rows.map((r) => ({
        id: r.id,
        quote: r.quote.toString(),
        durationDays: r.durationDays,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        needId: r.need.id,
        needTitle: r.need.title,
        needStatus: r.need.status,
      })),
    });
  }

  /**
   * 支持者对提案投票（F13，PRD 5.4「用付费承诺对应的选票」）。
   *
   * 规则：
   * - 仅竞标中可投；投票权重 = 该用户在此需求的有效承诺金额（分）。
   * - 一个需求一人一票：已有票时视为改票（先撤旧票再记新票），同提案重复投为幂等。
   * - 票数供发起者参考，最终决定权仍在发起者（select）。
   */
  async voteForProposal(
    actorId: string,
    needId: string,
    proposalId: string,
  ): Promise<Result<{ proposalId: string; weight: string; changed: boolean }>> {
    const need = await this.db.need.findUnique({
      where: { id: needId },
      select: { id: true, status: true, mode: true },
    });
    if (!need) return err("需求不存在", DomainError.NOT_FOUND);
    if (need.mode !== NeedMode.CROWDFUND) {
      return err("该需求不是众筹模式，由需求方直接选定方案，无需支持者投票", DomainError.FORBIDDEN);
    }
    if (need.status !== NeedStatus.BIDDING) {
      return err(
        `当前状态为「${NEED_STATUS_LABEL[need.status]}」，仅竞标中可投票`,
        DomainError.INVALID_STATE,
      );
    }

    const proposal = await this.db.proposal.findUnique({
      where: { id: proposalId },
      select: { id: true, needId: true, status: true },
    });
    if (!proposal || proposal.needId !== needId) {
      return err("提案不存在", DomainError.NOT_FOUND);
    }
    if (proposal.status !== ProposalStatus.SUBMITTED) {
      return err("该提案已不在候选中", DomainError.INVALID_STATE);
    }

    const pledges = await this.db.pledge.findMany({
      where: {
        needId,
        userId: actorId,
        status: { in: [PledgeStatus.FROZEN, PledgeStatus.LOCKED] },
      },
      select: { amount: true },
    });
    const weight = pledges.reduce((sum, p) => sum + p.amount, 0n);
    if (weight <= 0n) {
      return err("只有对该需求付过订金的支持者才能投票", DomainError.FORBIDDEN);
    }

    // 一人一票：撤掉该用户在本需求其他提案上的旧票（改票语义）
    const siblings = await this.db.proposal.findMany({
      where: { needId },
      select: { id: true },
    });
    const existing = await this.db.proposalVote.findMany({
      where: { userId: actorId, proposalId: { in: siblings.map((s) => s.id) } },
      select: { id: true, proposalId: true },
    });
    if (existing.some((v) => v.proposalId === proposalId)) {
      return ok({ proposalId, weight: weight.toString(), changed: false });
    }
    const stale = existing.filter((v) => v.proposalId !== proposalId);

    try {
      await this.db.$transaction(async (tx) => {
        if (stale.length > 0) {
          await tx.proposalVote.deleteMany({
            where: { id: { in: stale.map((v) => v.id) } },
          });
        }
        await tx.proposalVote.create({
          data: { proposalId, userId: actorId, weight },
        });
      });
    } catch (e) {
      // 并发重复投票：唯一约束 (proposalId, userId) 兜底，视为幂等成功
      if (e instanceof Error && e.message.includes("Unique")) {
        return ok({ proposalId, weight: weight.toString(), changed: false });
      }
      throw e;
    }

    await writeAudit({
      action: "VOTE",
      actorId,
      target: `need:${needId}`,
      detail: {
        event: "PROPOSAL_VOTED",
        proposalId,
        weight: weight.toString(),
        changed: stale.length > 0,
      },
    });

    return ok({ proposalId, weight: weight.toString(), changed: stale.length > 0 });
  }

  /** 当前用户在该需求的投票与可用票权（无票时 proposalId 为 null）。 */
  async viewerSelection(
    actorId: string,
    needId: string,
  ): Promise<{ proposalId: string | null; weight: string }> {
    const pledges = await this.db.pledge.findMany({
      where: {
        needId,
        userId: actorId,
        status: { in: [PledgeStatus.FROZEN, PledgeStatus.LOCKED] },
      },
      select: { amount: true },
    });
    const weight = pledges.reduce((sum, p) => sum + p.amount, 0n);

    const siblings = await this.db.proposal.findMany({
      where: { needId },
      select: { id: true },
    });
    if (siblings.length === 0) return { proposalId: null, weight: weight.toString() };

    const vote = await this.db.proposalVote.findFirst({
      where: { userId: actorId, proposalId: { in: siblings.map((s) => s.id) } },
      select: { proposalId: true },
    });
    return { proposalId: vote?.proposalId ?? null, weight: weight.toString() };
  }

  /** 选标（F13）：发起者或运营方选定一个提案，需求进入开发中并生成项目。 */
  async select(
    actorId: string,
    needId: string,
    proposalId: string,
  ): Promise<Result<{ projectId: string; proposalId: string; totalAmount: string }>> {
    const [actor, need] = await Promise.all([
      this.db.user.findUnique({ where: { id: actorId }, select: { id: true, roles: true } }),
      this.db.need.findUnique({
        where: { id: needId },
        select: {
          id: true,
          status: true,
          requesterId: true,
          pledgedAmount: true,
          mode: true,
          bountyAmount: true,
        },
      }),
    ]);
    if (!actor) return err("用户不存在", DomainError.NOT_FOUND);
    if (!need) return err("需求不存在", DomainError.NOT_FOUND);

    const isOperator = actor.roles.includes(UserRole.OPERATOR);
    if (!isOperator && need.requesterId !== actorId) {
      return err("只有需求发起者或运营方可以选标", DomainError.FORBIDDEN);
    }
    if (need.status !== NeedStatus.BIDDING) {
      return err(
        `当前状态为「${NEED_STATUS_LABEL[need.status]}」，仅竞标中可选标`,
        DomainError.INVALID_STATE,
      );
    }

    const proposal = await this.db.proposal.findUnique({
      where: { id: proposalId },
      select: { id: true, needId: true, status: true, quote: true },
    });
    if (!proposal || proposal.needId !== needId) {
      return err("提案不存在", DomainError.NOT_FOUND);
    }
    if (proposal.status !== ProposalStatus.SUBMITTED) {
      return err("该提案当前不可选", DomainError.INVALID_STATE);
    }

    try {
      const project = await this.db.$transaction(async (tx) => {
        await tx.proposal.update({
          where: { id: proposalId },
          data: { status: ProposalStatus.SELECTED },
        });
        await tx.proposal.updateMany({
          where: { needId, id: { not: proposalId }, status: ProposalStatus.SUBMITTED },
          data: { status: ProposalStatus.REJECTED },
        });

        const moved = await transitionNeedInTx(tx, {
          needId,
          from: NeedStatus.BIDDING,
          to: NeedStatus.IN_PROGRESS,
          mode: need.mode,
          reason: "已选定开发方案，进入开发阶段",
          actorId,
        });
        if (!moved) throw new SelectionConflict();

        // 托管总额按模式取值：悬赏为预付悬赏金，认领为 0，众筹为已承诺合计
        const totalAmount =
          need.mode === NeedMode.BOUNTY
            ? need.bountyAmount
            : need.mode === NeedMode.OPEN
              ? 0n
              : need.pledgedAmount;

        return tx.project.create({
          data: {
            needId,
            proposalId,
            status: "IN_PROGRESS",
            totalAmount,
            releasedAmount: 0n,
          },
          select: { id: true, totalAmount: true },
        });
      });

      await writeAudit({
        action: "PROPOSAL",
        actorId,
        target: `need:${needId}`,
        detail: { event: "PROPOSAL_SELECTED", proposalId, projectId: project.id },
      });

      return ok({
        projectId: project.id,
        proposalId,
        totalAmount: project.totalAmount.toString(),
      });
    } catch (e) {
      if (e instanceof SelectionConflict) {
        return err("该需求已被选标，请刷新后查看", DomainError.INVALID_STATE);
      }
      throw e;
    }
  }
}
