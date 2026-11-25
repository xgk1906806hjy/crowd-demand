import { KycStatus, NeedMode, NeedStatus, UserRole } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma/client";
import { ok, err, DomainError, type Result } from "@/domain/shared/result";
import { writeAudit } from "@/domain/shared/audit";
import { ESCROW_ACCOUNT, backerAccount, postTransfer } from "@/domain/ledger/service";
import { transitionNeedInTx } from "@/domain/need/transition";
import { NEED_STATUS_LABEL } from "@/domain/need/state-machine";
import {
  createPaymentGateway,
  type PaymentGateway,
} from "@/infrastructure/payment/gateway";

/**
 * 悬赏托管（F28）—— 需求方预付全额悬赏金，发布即可收方案。
 *
 * 与 Pledge 的分工：
 * - `Pledge` 记录「多人对同一需求的付费承诺」，参与众筹达标与选票权重；
 * - `BountyEscrow` 记录「一人预付的悬赏金」，不参与任何投票权重计算。
 * 两者都通过同一个 `postTransfer` 记账，账本口径统一，但业务语义分离。
 */
export const BOUNTY_LIMITS = {
  minCents: 10_000n, // 100 元
  maxCents: 100_000_000n, // 100 万元
  daysMin: 1,
  daysMax: 60,
} as const;

export interface BountyDepositView {
  needId: string;
  status: NeedStatus;
  bountyAmount: string;
  paymentRef: string | null;
  duplicated: boolean;
}

export interface BountyRefundView {
  needId: string;
  status: NeedStatus;
  refunded: string;
  duplicated: boolean;
}

export class BountyService {
  constructor(
    private readonly db: typeof prisma = prisma,
    private readonly gateway: PaymentGateway = createPaymentGateway(),
  ) {}

  /**
   * 悬赏预付：冻结悬赏金 → 记账进托管 → 需求从草稿进入方案征集。
   *
   * 幂等键固定为 `bounty-charge:{needId}`：同一需求重复调用只托管一次。
   */
  async deposit(
    userId: string,
    needId: string,
    options: { idempotencyKey?: string } = {},
  ): Promise<Result<BountyDepositView>> {
    const key = options.idempotencyKey?.trim() || `bounty-charge:${needId}`;
    if (key.length > 100) return err("幂等键过长", DomainError.VALIDATION);

    const [user, need] = await Promise.all([
      this.db.user.findUnique({
        where: { id: userId },
        select: { id: true, kycStatus: true },
      }),
      this.db.need.findUnique({
        where: { id: needId },
        select: {
          id: true,
          status: true,
          mode: true,
          requesterId: true,
          bountyAmount: true,
          publishedAt: true,
        },
      }),
    ]);
    if (!user) return err("用户不存在", DomainError.NOT_FOUND);
    if (!need) return err("需求不存在", DomainError.NOT_FOUND);

    if (need.mode !== NeedMode.BOUNTY) {
      return err("该需求不是悬赏模式，无需预付", DomainError.INVALID_STATE);
    }
    if (need.requesterId !== userId) {
      return err("只有需求发起者可以支付悬赏金", DomainError.FORBIDDEN);
    }
    if (user.kycStatus !== KycStatus.VERIFIED) {
      return err("支付悬赏金前需先完成实名认证", DomainError.FORBIDDEN);
    }
    if (need.bountyAmount < BOUNTY_LIMITS.minCents) {
      return err("悬赏金额不得低于 100 元", DomainError.VALIDATION);
    }
    if (need.bountyAmount > BOUNTY_LIMITS.maxCents) {
      return err("悬赏金额不得超过 1,000,000 元", DomainError.VALIDATION);
    }

    // 幂等：已托管过直接返回既有结果
    const existing = await this.db.bountyEscrow.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      return ok({
        needId,
        status: need.status,
        bountyAmount: existing.amount.toString(),
        paymentRef: existing.paymentRef,
        duplicated: true,
      });
    }

    if (need.status !== NeedStatus.DRAFT) {
      return err(
        `当前状态为「${NEED_STATUS_LABEL[need.status]}」，只有草稿状态的悬赏可以支付`,
        DomainError.INVALID_STATE,
      );
    }

    // 外部冻结在事务外：支付失败则不落任何业务数据
    const frozen = await this.gateway.freeze({ amount: need.bountyAmount, reference: key });

    const moved = await this.db.$transaction(async (tx) => {
      await tx.bountyEscrow.create({
        data: {
          needId,
          amount: need.bountyAmount,
          refundedAmount: 0n,
          paymentRef: frozen.ref,
          status: "HELD",
          idempotencyKey: key,
        },
      });

      // 复式账本：需求方虚拟账户 → 托管账户
      await postTransfer(tx, {
        from: backerAccount(userId),
        to: ESCROW_ACCOUNT,
        amount: need.bountyAmount,
        bizType: "BOUNTY",
        bizId: needId,
        idempotencyKey: key,
        memo: "悬赏金预付至托管",
      });

      await tx.paymentOrder.create({
        data: {
          idempotencyKey: key,
          type: "DEPOSIT",
          amount: need.bountyAmount,
          status: "SUCCESS",
          gateway: this.gateway.provider,
          gatewayRef: frozen.ref,
          payload: { needId, userId, kind: "BOUNTY_DEPOSIT" },
        },
      });

      // 悬赏不经过征集与承诺，直接开放方案征集
      const opened = await transitionNeedInTx(tx, {
        needId,
        from: NeedStatus.DRAFT,
        to: NeedStatus.BIDDING,
        mode: need.mode,
        reason: "悬赏金已托管，开放方案征集",
        actorId: userId,
        extra: { publishedAt: need.publishedAt ?? new Date() },
      });
      if (!opened) throw new DepositConflict();
      return true;
    }).catch((e) => {
      if (e instanceof DepositConflict) return false;
      throw e;
    });

    if (!moved) {
      return err("该悬赏已被处理，请刷新后重试", DomainError.INVALID_STATE);
    }

    await writeAudit({
      action: "PLEDGE",
      actorId: userId,
      target: `need:${needId}`,
      detail: {
        event: "BOUNTY_DEPOSITED",
        amount: need.bountyAmount.toString(),
        paymentRef: frozen.ref,
      },
    });

    return ok({
      needId,
      status: NeedStatus.BIDDING,
      bountyAmount: need.bountyAmount.toString(),
      paymentRef: frozen.ref,
      duplicated: false,
    });
  }

  /**
   * 撤回或流拍退款：把托管里**尚未放款**的部分全额退回需求方。
   *
   * 已放款的里程碑不追回（开发者已完成的工作应付费），这是与"全额原路退回"的区别。
   */
  async cancelAndRefund(
    userId: string,
    needId: string,
    reason?: string,
  ): Promise<Result<BountyRefundView>> {
    const key = `bountyrefund:${needId}`;

    const [need, actor] = await Promise.all([
      this.db.need.findUnique({
        where: { id: needId },
        select: { id: true, status: true, mode: true, requesterId: true },
      }),
      this.db.user.findUnique({ where: { id: userId }, select: { id: true, roles: true } }),
    ]);
    if (!need) return err("需求不存在", DomainError.NOT_FOUND);
    if (!actor) return err("用户不存在", DomainError.NOT_FOUND);
    if (need.mode !== NeedMode.BOUNTY) {
      return err("只有悬赏模式的需求支持悬赏退款", DomainError.INVALID_STATE);
    }

    const isOperator = actor.roles.includes(UserRole.OPERATOR);
    if (
      !isOperator &&
      need.requesterId !== userId
    ) {
      return err("只有需求发起者或运营方可以撤回悬赏", DomainError.FORBIDDEN);
    }

    const escrow = await this.db.bountyEscrow.findUnique({ where: { needId } });
    if (!escrow) return err("悬赏托管记录不存在", DomainError.NOT_FOUND);

    // 已退款过：幂等返回（放在状态校验之前，否则重复请求会被"状态不允许"误拒）
    if (escrow.status === "REFUNDED") {
      return ok({
        needId,
        status: need.status,
        refunded: escrow.refundedAmount.toString(),
        duplicated: true,
      });
    }

    if (need.status !== NeedStatus.BIDDING && need.status !== NeedStatus.IN_PROGRESS) {
      return err(
        `当前状态为「${NEED_STATUS_LABEL[need.status]}」，无法撤回`,
        DomainError.INVALID_STATE,
      );
    }

    // 剩余可退 = 托管总额 − 已放款
    const project = await this.db.project.findFirst({
      where: { needId },
      select: { id: true, releasedAmount: true },
    });
    const released = project?.releasedAmount ?? 0n;
    const refundable = escrow.amount - released - escrow.refundedAmount;
    if (refundable <= 0n) {
      return err("托管余额已全部放款，无可退金额", DomainError.INVALID_STATE);
    }

    const refunded = await this.gateway.refund({ amount: refundable, reference: key });

    await this.db.$transaction(async (tx) => {
      await postTransfer(tx, {
        from: ESCROW_ACCOUNT,
        to: backerAccount(need.requesterId),
        amount: refundable,
        bizType: "REFUND",
        bizId: key,
        idempotencyKey: key,
        memo: "悬赏未使用部分退回需求方",
      });

      await tx.paymentOrder.create({
        data: {
          idempotencyKey: key,
          type: "REFUND",
          amount: refundable,
          status: "SUCCESS",
          gateway: this.gateway.provider,
          gatewayRef: refunded.ref,
          payload: { needId, kind: "BOUNTY_REFUND", released: released.toString() },
        },
      });

      await tx.bountyEscrow.update({
        where: { needId },
        data: { refundedAmount: { increment: refundable }, status: "REFUNDED" },
      });

      // 状态机：先转已流拍，再转已退款（终态），不跳过中间态
      const failed = await transitionNeedInTx(tx, {
        needId,
        from: need.status,
        to: NeedStatus.FAILED,
        mode: need.mode,
        reason: reason?.trim() || "需求方撤回悬赏",
        actorId: userId,
      });
      if (!failed) throw new RefundConflict();

      const done = await transitionNeedInTx(tx, {
        needId,
        from: NeedStatus.FAILED,
        to: NeedStatus.REFUNDED,
        mode: need.mode,
        reason: reason?.trim() || "悬赏撤回，托管余额退回",
        actorId: userId,
      });
      if (!done) throw new RefundConflict();

      if (project) {
        await tx.project.update({
          where: { id: project.id },
          data: { status: "REFUNDED" },
        });
      }
    }).catch((e) => {
      if (e instanceof RefundConflict) throw new Error("该悬赏已被撤回，请刷新后查看");
      throw e;
    });

    await writeAudit({
      action: "REFUND",
      actorId: userId,
      target: `need:${needId}`,
      detail: {
        event: "BOUNTY_REFUNDED",
        refunded: refundable.toString(),
        released: released.toString(),
        refundRef: refunded.ref,
      },
    });

    return ok({
      needId,
      status: NeedStatus.REFUNDED,
      refunded: refundable.toString(),
      duplicated: false,
    });
  }
}

class DepositConflict extends Error {}
class RefundConflict extends Error {}
