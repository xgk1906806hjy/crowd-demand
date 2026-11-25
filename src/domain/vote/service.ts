import { NeedStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma/client";
import { writeAudit } from "@/domain/shared/audit";
import { ok, err, DomainError, type Result } from "@/domain/shared/result";
import { isVotable, NEED_STATUS_LABEL } from "@/domain/need/state-machine";
import { transitionNeedInTx } from "@/domain/need/transition";

export interface VoteResultView {
  voted: boolean;
  voteCount: number;
  voteThreshold: number;
  status: NeedStatus;
  thresholdReached: boolean;
}

/**
 * 投票（F07）—— 反刷票两道闸（2026-11-24 调整）：
 * 1) 登录即可投，不再要求实名；一人一票由数据库唯一约束 `(needId, userId)` 保证；
 * 2) 征集期与竞标期均可投（竞标期仅作支持表态，票数达标只在征集期触发状态流转）。
 */
export class VoteService {
  constructor(private readonly db: typeof prisma = prisma) {}

  /** 投支持票。重复投票幂等返回当前状态，不报错。 */
  async cast(userId: string, needId: string, ip?: string): Promise<Result<VoteResultView>> {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) return err("用户不存在", DomainError.NOT_FOUND);

    const need = await this.db.need.findUnique({
      where: { id: needId },
      select: { id: true, status: true, voteCount: true, voteThreshold: true },
    });
    if (!need) return err("需求不存在", DomainError.NOT_FOUND);
    if (!isVotable(need.status)) {
      return err(
        `当前状态为「${NEED_STATUS_LABEL[need.status]}」，仅征集中可投票`,
        DomainError.INVALID_STATE,
      );
    }

    const existing = await this.db.vote.findUnique({
      where: { needId_userId: { needId, userId } },
      select: { id: true },
    });
    if (existing) {
      return ok({
        voted: true,
        voteCount: need.voteCount,
        voteThreshold: need.voteThreshold,
        status: need.status,
        thresholdReached: need.voteCount >= need.voteThreshold,
      });
    }

    // 事务内：写票 → 票数自增 → 达标则流转到承诺期
    const outcome = await this.db.$transaction(async (tx) => {
      await tx.vote.create({ data: { needId, userId } });
      const updated = await tx.need.update({
        where: { id: needId },
        data: { voteCount: { increment: 1 } },
        select: { voteCount: true, voteThreshold: true, status: true },
      });

      let status = updated.status;
      let thresholdReached = updated.voteCount >= updated.voteThreshold;

      if (thresholdReached && updated.status === NeedStatus.COLLECTING) {
        // 条件更新 + 状态机校验，避免并发重复流转
        const moved = await transitionNeedInTx(tx, {
          needId,
          from: NeedStatus.COLLECTING,
          to: NeedStatus.PLEDGING,
          reason: `票数达标（${updated.voteCount}/${updated.voteThreshold}），进入承诺期`,
        });
        if (moved) {
          status = NeedStatus.PLEDGING;
        }
        thresholdReached = status === NeedStatus.PLEDGING;
      }

      return { voteCount: updated.voteCount, voteThreshold: updated.voteThreshold, status, thresholdReached };
    });

    await writeAudit({
      action: "VOTE",
      actorId: userId,
      target: `need:${needId}`,
      detail: { event: "VOTE_CAST", voteCount: outcome.voteCount },
      ip,
    });

    return ok({ voted: true, ...outcome });
  }

  /** 取消投票：仅征集期可撤。 */
  async cancel(userId: string, needId: string, ip?: string): Promise<Result<VoteResultView>> {
    const need = await this.db.need.findUnique({
      where: { id: needId },
      select: { id: true, status: true, voteCount: true, voteThreshold: true },
    });
    if (!need) return err("需求不存在", DomainError.NOT_FOUND);
    if (!isVotable(need.status)) {
      return err("投票已截止，无法撤回", DomainError.INVALID_STATE);
    }

    const existing = await this.db.vote.findUnique({
      where: { needId_userId: { needId, userId } },
      select: { id: true },
    });
    if (!existing) {
      return ok({
        voted: false,
        voteCount: need.voteCount,
        voteThreshold: need.voteThreshold,
        status: need.status,
        thresholdReached: need.voteCount >= need.voteThreshold,
      });
    }

    const outcome = await this.db.$transaction(async (tx) => {
      await tx.vote.delete({ where: { id: existing.id } });
      const updated = await tx.need.update({
        where: { id: needId },
        data: { voteCount: { decrement: 1 } },
        select: { voteCount: true, voteThreshold: true, status: true },
      });
      return updated;
    });

    await writeAudit({
      action: "VOTE",
      actorId: userId,
      target: `need:${needId}`,
      detail: { event: "VOTE_CANCELLED", voteCount: outcome.voteCount },
      ip,
    });

    return ok({
      voted: false,
      voteCount: outcome.voteCount,
      voteThreshold: outcome.voteThreshold,
      status: outcome.status,
      thresholdReached: outcome.voteCount >= outcome.voteThreshold,
    });
  }
}
