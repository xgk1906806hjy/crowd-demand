import {
  MilestoneStatus,
  NeedStatus,
  UserRole,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/infrastructure/prisma/client";
import { writeAudit } from "@/domain/shared/audit";
import { ok, err, DomainError, type Result } from "@/domain/shared/result";
import { releaseMilestoneInTx, settleProjectInTx } from "@/domain/payout/service";

export const MILESTONE_LIMITS = {
  countMin: 1,
  countMax: 5,
  titleMin: 2,
  titleMax: 60,
  deliverableMin: 10,
  deliverableMax: 2000,
  totalRatio: 10_000, // 万分比
} as const;

export interface PlanItem {
  title: string;
  deliverable: string;
  /** 万分比，例如 3000 = 30% */
  releaseRatio: number;
}

export interface MilestoneView {
  id: string;
  seq: number;
  title: string;
  deliverable: string;
  releaseRatio: number;
  releaseAmount: string;
  status: MilestoneStatus;
  submittedAt: string | null;
  acceptedAt: string | null;
}

export interface ProjectView {
  projectId: string;
  status: string;
  totalAmount: string;
  releasedAmount: string;
  quote: string;
  builderId: string;
  builderName: string;
  milestones: MilestoneView[];
  viewer: {
    isBuilder: boolean;
    isRequester: boolean;
    canPlan: boolean;
    canAccept: boolean;
  };
}

function len(s: string): number {
  return Array.from(s.trim()).length;
}

export class MilestoneService {
  constructor(private readonly db: typeof prisma = prisma) {}

  /** 拆分里程碑（F14）：中标开发者在开工前定义节点与放款比例。 */
  async plan(
    actorId: string,
    projectId: string,
    items: PlanItem[],
  ): Promise<Result<{ count: number }>> {
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        proposalId: true,
        proposal: { select: { builderId: true, quote: true } },
        _count: { select: { milestones: true } },
      },
    });
    if (!project) return err("项目不存在", DomainError.NOT_FOUND);

    const actor = await this.db.user.findUnique({
      where: { id: actorId },
      select: { roles: true },
    });
    const isOperator = actor?.roles.includes(UserRole.OPERATOR) ?? false;
    if (!isOperator && project.proposal.builderId !== actorId) {
      return err("只有中标开发者或运营方可以拆分里程碑", DomainError.FORBIDDEN);
    }
    if (project.status !== "IN_PROGRESS") {
      return err("项目当前状态不可拆分里程碑", DomainError.INVALID_STATE);
    }
    if ((project._count?.milestones ?? 0) > 0) {
      return err("里程碑已拆分，不可重复设置", DomainError.CONFLICT);
    }
    if (
      items.length < MILESTONE_LIMITS.countMin ||
      items.length > MILESTONE_LIMITS.countMax
    ) {
      return err(
        `里程碑需为 ${MILESTONE_LIMITS.countMin}-${MILESTONE_LIMITS.countMax} 个`,
        DomainError.VALIDATION,
      );
    }

    let ratioSum = 0;
    for (const item of items) {
      if (
        len(item.title) < MILESTONE_LIMITS.titleMin ||
        len(item.title) > MILESTONE_LIMITS.titleMax
      ) {
        return err(`节点标题需为 2-60 字：${item.title}`, DomainError.VALIDATION);
      }
      if (
        len(item.deliverable) < MILESTONE_LIMITS.deliverableMin ||
        len(item.deliverable) > MILESTONE_LIMITS.deliverableMax
      ) {
        return err(`交付物说明需为 10-2000 字：${item.title}`, DomainError.VALIDATION);
      }
      if (
        !Number.isInteger(item.releaseRatio) ||
        item.releaseRatio <= 0 ||
        item.releaseRatio > MILESTONE_LIMITS.totalRatio
      ) {
        return err(`放款比例不合法：${item.title}`, DomainError.VALIDATION);
      }
      ratioSum += item.releaseRatio;
    }
    if (ratioSum !== MILESTONE_LIMITS.totalRatio) {
      return err(
        `放款比例合计必须为 100%（当前 ${(ratioSum / 100).toFixed(2)}%）`,
        DomainError.VALIDATION,
      );
    }

    // 金额以中标报价为基数（托管总额与报价的差额在结算时退回支持者），
    // 按比例取整，最后一个节点承接余数，保证合计等于报价
    const base = project.proposal.quote;
    if (base <= 0n) {
      return err("中标报价不合法，无法拆分里程碑", DomainError.INVALID_STATE);
    }

    const amounts: bigint[] = [];
    let allocated = 0n;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!item) continue;
      const isLast = i === items.length - 1;
      const amount = isLast
        ? base - allocated
        : (base * BigInt(item.releaseRatio)) / BigInt(MILESTONE_LIMITS.totalRatio);
      amounts.push(amount);
      allocated += amount;
    }

    await this.db.$transaction(
      items.map((item, index) =>
        this.db.milestone.create({
          data: {
            projectId,
            proposalId: project.proposalId,
            seq: index + 1,
            title: item.title.trim(),
            deliverable: item.deliverable.trim(),
            releaseRatio: item.releaseRatio,
            releaseAmount: amounts[index] ?? 0n,
            status: MilestoneStatus.PENDING,
          },
        }),
      ),
    );

    await writeAudit({
      action: "MILESTONE",
      actorId,
      target: `project:${projectId}`,
      detail: { event: "MILESTONES_PLANNED", count: items.length },
    });

    return ok({ count: items.length });
  }

  /** 提交节点交付物（F14）。 */
  async submit(
    actorId: string,
    milestoneId: string,
    note: string,
  ): Promise<Result<{ status: MilestoneStatus }>> {
    const milestone = await this.db.milestone.findUnique({
      where: { id: milestoneId },
      select: {
        id: true,
        status: true,
        projectId: true,
        project: {
          select: {
            id: true,
            needId: true,
            proposal: { select: { builderId: true } },
          },
        },
      },
    });
    if (!milestone) return err("里程碑不存在", DomainError.NOT_FOUND);

    const actor = await this.db.user.findUnique({
      where: { id: actorId },
      select: { roles: true },
    });
    const isOperator = actor?.roles.includes(UserRole.OPERATOR) ?? false;
    if (!isOperator && milestone.project.proposal.builderId !== actorId) {
      return err("只有中标开发者可以提交节点交付物", DomainError.FORBIDDEN);
    }
    if (milestone.status !== MilestoneStatus.PENDING) {
      return err("该节点当前不可提交", DomainError.INVALID_STATE);
    }
    if (note && len(note) > 2000) {
      return err("交付说明不得超过 2000 字", DomainError.VALIDATION);
    }

    await this.db.$transaction(async (tx) => {
      await tx.milestone.update({
        where: { id: milestoneId },
        data: {
          status: MilestoneStatus.SUBMITTED,
          submittedAt: new Date(),
          deliverable: note?.trim() || undefined,
        },
      });

      await tx.project.update({
        where: { id: milestone.projectId },
        data: { status: "ACCEPTING" },
      });

      const moved = await tx.need.updateMany({
        where: { id: milestone.project.needId, status: NeedStatus.IN_PROGRESS },
        data: { status: NeedStatus.ACCEPTING },
      });
      if (moved.count === 1) {
        await tx.needStatusLog.create({
          data: {
            needId: milestone.project.needId,
            fromStatus: NeedStatus.IN_PROGRESS,
            toStatus: NeedStatus.ACCEPTING,
            reason: "开发者提交里程碑交付物，进入验收",
            actorId,
          },
        });
      }
    });

    await writeAudit({
      action: "MILESTONE",
      actorId,
      target: `milestone:${milestoneId}`,
      detail: { event: "MILESTONE_SUBMITTED" },
    });

    return ok({ status: MilestoneStatus.SUBMITTED });
  }

  /** 验收并放款（F15/F16）：发起者确认 → 托管放款 → 若全部完成则结算（F17）。 */
  async accept(
    actorId: string,
    milestoneId: string,
  ): Promise<Result<{ released: string; projectCompleted: boolean; refunded: string }>> {
    const milestone = await this.db.milestone.findUnique({
      where: { id: milestoneId },
      select: {
        id: true,
        status: true,
        releaseAmount: true,
        projectId: true,
        project: {
          select: {
            id: true,
            needId: true,
            totalAmount: true,
            proposal: { select: { quote: true, builderId: true } },
          },
        },
      },
    });
    if (!milestone) return err("里程碑不存在", DomainError.NOT_FOUND);

    const [actor, need] = await Promise.all([
      this.db.user.findUnique({ where: { id: actorId }, select: { roles: true } }),
      this.db.need.findUnique({
        where: { id: milestone.project.needId },
        select: { requesterId: true },
      }),
    ]);
    if (!need) return err("需求不存在", DomainError.NOT_FOUND);

    const isOperator = actor?.roles.includes(UserRole.OPERATOR) ?? false;
    if (!isOperator && need.requesterId !== actorId) {
      return err("只有需求发起者或运营方可以验收", DomainError.FORBIDDEN);
    }
    if (milestone.status !== MilestoneStatus.SUBMITTED) {
      return err("该节点尚未提交交付物，无法验收", DomainError.INVALID_STATE);
    }

    const result = await this.db.$transaction(async (tx) => {
      await tx.milestone.update({
        where: { id: milestoneId },
        data: { status: MilestoneStatus.ACCEPTED, acceptedAt: new Date() },
      });

      const payoutId = await releaseMilestoneInTx(tx, {
        projectId: milestone.projectId,
        milestoneId,
        needId: milestone.project.needId,
        payeeId: milestone.project.proposal.builderId,
        amount: milestone.releaseAmount,
      });

      const remaining = await tx.milestone.count({
        where: { projectId: milestone.projectId, status: { not: MilestoneStatus.RELEASED } },
      });

      let refunded = 0n;
      if (remaining === 0) {
        const settled = await settleProjectInTx(tx, {
          projectId: milestone.projectId,
          needId: milestone.project.needId,
          totalAmount: milestone.project.totalAmount,
          quote: milestone.project.proposal.quote,
          actorId,
        });
        refunded = settled.refunded;
      }

      return { payoutId, refunded, completed: remaining === 0 };
    });

    await writeAudit({
      action: "PAYOUT",
      actorId,
      target: `milestone:${milestoneId}`,
      detail: {
        event: "MILESTONE_RELEASED",
        payoutId: result.payoutId,
        amount: milestone.releaseAmount.toString(),
        projectCompleted: result.completed,
      },
    });

    return ok({
      released: milestone.releaseAmount.toString(),
      projectCompleted: result.completed,
      refunded: result.refunded.toString(),
    });
  }

  /** 验收不通过（F15）：退回开发者修改。 */
  async reject(
    actorId: string,
    milestoneId: string,
    reason: string,
  ): Promise<Result<{ status: MilestoneStatus }>> {
    const milestone = await this.db.milestone.findUnique({
      where: { id: milestoneId },
      select: { id: true, status: true, project: { select: { needId: true } } },
    });
    if (!milestone) return err("里程碑不存在", DomainError.NOT_FOUND);

    const [actor, need] = await Promise.all([
      this.db.user.findUnique({ where: { id: actorId }, select: { roles: true } }),
      this.db.need.findUnique({
        where: { id: milestone.project.needId },
        select: { requesterId: true },
      }),
    ]);
    const isOperator = actor?.roles.includes(UserRole.OPERATOR) ?? false;
    if (!isOperator && need?.requesterId !== actorId) {
      return err("只有需求发起者或运营方可以驳回", DomainError.FORBIDDEN);
    }
    if (milestone.status !== MilestoneStatus.SUBMITTED) {
      return err("该节点当前不可驳回", DomainError.INVALID_STATE);
    }
    if (len(reason) < 5) {
      return err("请填写至少 5 个字的驳回原因", DomainError.VALIDATION);
    }

    await this.db.milestone.update({
      where: { id: milestoneId },
      data: { status: MilestoneStatus.DISPUTED },
    });

    await writeAudit({
      action: "MILESTONE",
      actorId,
      target: `milestone:${milestoneId}`,
      detail: { event: "MILESTONE_REJECTED", reason },
    });

    return ok({ status: MilestoneStatus.DISPUTED });
  }

  /** 需求详情页的项目面板数据。 */
  async getByNeed(needId: string, viewerId?: string | null): Promise<Result<ProjectView | null>> {
    const project = await this.db.project.findUnique({
      where: { needId },
      select: {
        id: true,
        status: true,
        totalAmount: true,
        releasedAmount: true,
        proposal: {
          select: { quote: true, builderId: true, builder: { select: { nickname: true } } },
        },
        milestones: {
          orderBy: { seq: "asc" },
          select: {
            id: true,
            seq: true,
            title: true,
            deliverable: true,
            releaseRatio: true,
            releaseAmount: true,
            status: true,
            submittedAt: true,
            acceptedAt: true,
          },
        },
        need: { select: { requesterId: true } },
      },
    });
    if (!project) return ok(null);

    const isBuilder = viewerId != null && viewerId === project.proposal.builderId;
    const isRequester = viewerId != null && viewerId === project.need.requesterId;

    return ok({
      projectId: project.id,
      status: project.status,
      totalAmount: project.totalAmount.toString(),
      releasedAmount: project.releasedAmount.toString(),
      quote: project.proposal.quote.toString(),
      builderId: project.proposal.builderId,
      builderName: project.proposal.builder.nickname ?? "匿名开发者",
      milestones: project.milestones.map((m) => ({
        id: m.id,
        seq: m.seq,
        title: m.title,
        deliverable: m.deliverable,
        releaseRatio: m.releaseRatio,
        releaseAmount: m.releaseAmount.toString(),
        status: m.status,
        submittedAt: m.submittedAt?.toISOString() ?? null,
        acceptedAt: m.acceptedAt?.toISOString() ?? null,
      })),
      viewer: {
        isBuilder,
        isRequester,
        canPlan: isBuilder && project.status === "IN_PROGRESS" && project.milestones.length === 0,
        canAccept: isRequester,
      },
    });
  }
}

export type MilestoneTx = Prisma.TransactionClient;
