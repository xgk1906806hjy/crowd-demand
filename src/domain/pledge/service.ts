import { randomUUID } from "node:crypto";
import {
  KycStatus,
  NeedStatus,
  PledgeStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/infrastructure/prisma/client";
import { env } from "@/lib/env";
import { writeAudit } from "@/domain/shared/audit";
import { ok, err, DomainError, type Result } from "@/domain/shared/result";
import { NEED_STATUS_LABEL, isPledgeable } from "@/domain/need/state-machine";
import { computeProgress } from "@/domain/need/query";
import { ESCROW_ACCOUNT, backerAccount, postTransfer } from "@/domain/ledger/service";
import {
  createPaymentGateway,
  type PaymentGateway,
} from "@/infrastructure/payment/gateway";

/** 单笔最低承诺 10 元，避免大量 1 分钱测试单污染账本。 */
export const MIN_PLEDGE_CENTS = 1_000n;

export interface PledgeInput {
  amount: bigint;
  /** 客户端幂等键；不传则服务端生成。 */
  idempotencyKey?: string;
}

export interface PledgeView {
  id: string;
  needId: string;
  amount: string;
  status: PledgeStatus;
  createdAt: string;
  backerName: string;
}

export interface PledgeOutcome {
  pledgeId: string;
  pledgedAmount: string;
  targetAmount: string;
  progress: number;
  needStatus: NeedStatus;
  funded: boolean;
}

export class PledgeService {
  constructor(
    private readonly db: typeof prisma = prisma,
    private readonly gateway: PaymentGateway = createPaymentGateway(),
  ) {}

  /** 付费承诺（F09）：资金进入托管，达标即锁定并进入竞标（F11）。 */
  async pledge(
    userId: string,
    needId: string,
    input: PledgeInput,
    ip?: string,
  ): Promise<Result<PledgeOutcome>> {
    if (input.amount <= 0n) {
      return err("承诺金额必须大于 0", DomainError.VALIDATION);
    }
    if (input.amount < MIN_PLEDGE_CENTS) {
      return err("单笔承诺不得低于 10 元", DomainError.VALIDATION);
    }
    const maxSingle = BigInt(env.MAX_PLEDGE_AMOUNT_CENTS);
    if (input.amount > maxSingle) {
      return err(`单笔承诺不得超过 ${maxSingle / 100n} 元`, DomainError.VALIDATION);
    }

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, kycStatus: true },
    });
    if (!user) return err("用户不存在", DomainError.NOT_FOUND);
    if (user.kycStatus !== KycStatus.VERIFIED) {
      return err("付费承诺前需先完成实名认证", DomainError.FORBIDDEN);
    }

    const need = await this.db.need.findUnique({
      where: { id: needId },
      select: {
        id: true,
        status: true,
        deadline: true,
        targetAmount: true,
        pledgedAmount: true,
      },
    });
    if (!need) return err("需求不存在", DomainError.NOT_FOUND);
    if (!isPledgeable(need.status)) {
      return err(
        `当前状态为「${NEED_STATUS_LABEL[need.status]}」，仅承诺中可预付订金`,
        DomainError.INVALID_STATE,
      );
    }
    if (need.deadline && need.deadline.getTime() <= Date.now()) {
      return err("承诺已截止，无法继续支持", DomainError.INVALID_STATE);
    }

    const key = input.idempotencyKey?.trim() || `pledge:${userId}:${needId}:${randomUUID()}`;
    if (key.length > 100) {
      return err("幂等键过长", DomainError.VALIDATION);
    }

    // 幂等：同一请求重复提交直接返回既有结果
    const existing = await this.db.pledge.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      return ok({
        pledgeId: existing.id,
        pledgedAmount: need.pledgedAmount.toString(),
        targetAmount: need.targetAmount.toString(),
        progress: computeProgress(need.pledgedAmount, need.targetAmount),
        needStatus: need.status,
        funded: need.pledgedAmount >= need.targetAmount && need.targetAmount > 0n,
      });
    }

    // 单人单需求累计上限
    const mine = await this.db.pledge.aggregate({
      where: { userId, needId, status: { not: PledgeStatus.REFUNDED } },
      _sum: { amount: true },
    });
    const already = mine._sum.amount ?? 0n;
    const maxUser = BigInt(env.MAX_USER_PLEDGE_CENTS);
    if (already + input.amount > maxUser) {
      return err(`同一需求累计承诺不得超过 ${maxUser / 100n} 元`, DomainError.VALIDATION);
    }

    // 冻结资金（外部调用放在事务外，失败则不落库）
    const frozen = await this.gateway.freeze({ amount: input.amount, reference: key });

    const outcome = await this.db.$transaction(async (tx) => {
      const pledge = await tx.pledge.create({
        data: {
          userId,
          needId,
          amount: input.amount,
          status: PledgeStatus.FROZEN,
          idempotencyKey: key,
          paymentRef: frozen.ref,
        },
      });

      // 复式账本：支持者账户 → 托管账户
      await postTransfer(tx, {
        from: backerAccount(userId),
        to: ESCROW_ACCOUNT,
        amount: input.amount,
        bizType: "PLEDGE",
        bizId: pledge.id,
        idempotencyKey: key,
        pledgeId: pledge.id,
        memo: "付费承诺（预购订金）冻结至托管",
      });

      const updated = await tx.need.update({
        where: { id: needId },
        data: { pledgedAmount: { increment: input.amount } },
        select: { pledgedAmount: true, targetAmount: true, status: true },
      });

      await tx.paymentOrder.create({
        data: {
          idempotencyKey: key,
          type: "FREEZE",
          amount: input.amount,
          status: "SUCCESS",
          gateway: this.gateway.provider,
          gatewayRef: frozen.ref,
          payload: { needId, userId, pledgeId: pledge.id },
        },
      });

      let status = updated.status;
      let funded = updated.targetAmount > 0n && updated.pledgedAmount >= updated.targetAmount;

      if (funded && updated.status === NeedStatus.PLEDGING) {
        const moved = await tx.need.updateMany({
          where: { id: needId, status: NeedStatus.PLEDGING },
          data: { status: NeedStatus.BIDDING },
        });
        if (moved.count === 1) {
          await tx.pledge.updateMany({
            where: { needId, status: PledgeStatus.FROZEN },
            data: { status: PledgeStatus.LOCKED },
          });
          await tx.needStatusLog.create({
            data: {
              needId,
              fromStatus: NeedStatus.PLEDGING,
              toStatus: NeedStatus.BIDDING,
              reason: "承诺金额达标，资金锁定并进入竞标",
              actorId: null,
            },
          });
          status = NeedStatus.BIDDING;
        } else {
          funded = false;
        }
      }

      return {
        pledgeId: pledge.id,
        pledgedAmount: updated.pledgedAmount,
        targetAmount: updated.targetAmount,
        status,
        funded,
      };
    });

    await writeAudit({
      action: "PLEDGE",
      actorId: userId,
      target: `need:${needId}`,
      detail: {
        event: "PLEDGE_CREATED",
        pledgeId: outcome.pledgeId,
        amount: outcome.pledgedAmount.toString(),
        funded: outcome.funded,
      },
      ip,
    });

    return ok({
      pledgeId: outcome.pledgeId,
      pledgedAmount: outcome.pledgedAmount.toString(),
      targetAmount: outcome.targetAmount.toString(),
      progress: computeProgress(outcome.pledgedAmount, outcome.targetAmount),
      needStatus: outcome.status,
      funded: outcome.funded,
    });
  }

  /** 某需求的公开承诺列表（不展示手机号）。 */
  async listByNeed(needId: string, limit = 20): Promise<Result<{ items: PledgeView[]; total: string }>> {
    const [rows, agg] = await Promise.all([
      this.db.pledge.findMany({
        where: { needId, status: { not: PledgeStatus.REFUNDED } },
        orderBy: { createdAt: "desc" },
        take: Math.min(50, Math.max(1, limit)),
        select: {
          id: true,
          needId: true,
          amount: true,
          status: true,
          createdAt: true,
          user: { select: { nickname: true } },
        },
      }),
      this.db.pledge.aggregate({
        where: { needId, status: { not: PledgeStatus.REFUNDED } },
        _sum: { amount: true },
      }),
    ]);

    return ok({
      items: rows.map((r) => ({
        id: r.id,
        needId: r.needId,
        amount: r.amount.toString(),
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        backerName: r.user.nickname ?? "匿名支持者",
      })),
      total: (agg._sum.amount ?? 0n).toString(),
    });
  }

  /** 我的承诺（控制台）。 */
  async listMine(userId: string, limit = 50): Promise<Result<{ items: Array<Record<string, unknown>> }>> {
    const rows = await this.db.pledge.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(100, Math.max(1, limit)),
      select: {
        id: true,
        amount: true,
        status: true,
        createdAt: true,
        need: { select: { id: true, title: true, status: true } },
      },
    });

    return ok({
      items: rows.map((r) => ({
        id: r.id,
        amount: r.amount.toString(),
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        needId: r.need.id,
        needTitle: r.need.title,
        needStatus: r.need.status,
      })),
    });
  }
}

/** 事务客户端类型别名，供退款流程复用。 */
export type PledgeTx = Prisma.TransactionClient;
