import {
  KycStatus,
  NeedStatus,
  ProposalStatus,
  UserRole,
} from "@prisma/client";
import { prisma } from "@/infrastructure/prisma/client";
import { writeAudit } from "@/domain/shared/audit";
import { ok, err, DomainError, type Result } from "@/domain/shared/result";
import { NEED_STATUS_LABEL } from "@/domain/need/state-machine";

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
      select: { id: true, roles: true, kycStatus: true },
    });
    if (!user) return err("用户不存在", DomainError.NOT_FOUND);
    if (!user.roles.includes(UserRole.BUILDER)) {
      return err("提交提案前需先申请开发者角色", DomainError.FORBIDDEN);
    }
    if (user.kycStatus !== KycStatus.VERIFIED) {
      return err("提交提案前需完成实名认证", DomainError.FORBIDDEN);
    }

    const need = await this.db.need.findUnique({
      where: { id: needId },
      select: { id: true, status: true, pledgedAmount: true },
    });
    if (!need) return err("需求不存在", DomainError.NOT_FOUND);
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
    if (input.quote <= 0n) {
      return err("报价必须大于 0", DomainError.VALIDATION);
    }
    // 报价不得超过已托管资金，否则中标后无法兑付
    if (input.quote > need.pledgedAmount) {
      return err("报价不得超过该需求已托管的承诺总额", DomainError.VALIDATION);
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
        select: { id: true, status: true, requesterId: true, pledgedAmount: true },
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

        const moved = await tx.need.updateMany({
          where: { id: needId, status: NeedStatus.BIDDING },
          data: { status: NeedStatus.IN_PROGRESS },
        });
        if (moved.count !== 1) throw new SelectionConflict();

        await tx.needStatusLog.create({
          data: {
            needId,
            fromStatus: NeedStatus.BIDDING,
            toStatus: NeedStatus.IN_PROGRESS,
            reason: "已选定开发方案，进入开发阶段",
            actorId,
          },
        });

        return tx.project.create({
          data: {
            needId,
            proposalId,
            status: "IN_PROGRESS",
            totalAmount: need.pledgedAmount,
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
