import { NeedStatus, PledgeStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma/client";
import { writeAudit } from "@/domain/shared/audit";
import { ok, err, DomainError, type Result } from "@/domain/shared/result";
import { ESCROW_ACCOUNT, backerAccount, postTransfer } from "@/domain/ledger/service";
import { transitionNeedInTx } from "@/domain/need/transition";
import {
  createPaymentGateway,
  type PaymentGateway,
} from "@/infrastructure/payment/gateway";

export interface LifecycleOptions {
  db?: typeof prisma;
  gateway?: PaymentGateway;
}

export interface RefundSummary {
  count: number;
  total: bigint;
  /** 外部通道调用失败的笔数；>0 时需求不能置为已退款，需重试 */
  failed: number;
}

/**
 * 全额退款（F11/F17）：托管账户 → 每个支持者账户，逐笔事务处理。
 * 幂等键 `refund:{pledgeId}`，重复执行不会重复退款。
 *
 * 外部退款先于本地记账：网关按 reference 幂等，若本地事务失败，重试时不会二次划账；
 * 任一笔失败只跳过该笔并计入 `failed`，不阻塞其余支持者退款。
 */
export async function refundNeedPledges(
  needId: string,
  options: LifecycleOptions = {},
): Promise<RefundSummary> {
  const db = options.db ?? prisma;
  const gateway = options.gateway ?? createPaymentGateway();

  const pledges = await db.pledge.findMany({
    where: { needId, status: { in: [PledgeStatus.FROZEN, PledgeStatus.LOCKED] } },
    select: { id: true, userId: true, amount: true },
  });

  let total = 0n;
  let count = 0;
  let failed = 0;

  for (const pledge of pledges) {
    const key = `refund:${pledge.id}`;

    try {
      const refunded = await gateway.refund({ amount: pledge.amount, reference: key });

      await db.$transaction(async (tx) => {
        await postTransfer(tx, {
          from: ESCROW_ACCOUNT,
          to: backerAccount(pledge.userId),
          amount: pledge.amount,
          bizType: "REFUND",
          bizId: pledge.id,
          idempotencyKey: key,
          pledgeId: pledge.id,
          memo: "未达标全额原路退款",
        });

        await tx.pledge.update({
          where: { id: pledge.id },
          data: { status: PledgeStatus.REFUNDED },
        });

        await tx.paymentOrder.create({
          data: {
            idempotencyKey: key,
            type: "REFUND",
            amount: pledge.amount,
            status: "SUCCESS",
            gateway: gateway.provider,
            gatewayRef: refunded.ref,
            payload: { needId, pledgeId: pledge.id },
          },
        });
      });

      await writeAudit({
        action: "REFUND",
        target: `need:${needId}`,
        detail: { event: "PLEDGE_REFUNDED", pledgeId: pledge.id, amount: pledge.amount.toString() },
      });

      total += pledge.amount;
      count += 1;
    } catch (e) {
      failed += 1;
      await writeAudit({
        action: "REFUND",
        target: `need:${needId}`,
        detail: {
          event: "PLEDGE_REFUND_FAILED",
          pledgeId: pledge.id,
          reason: e instanceof Error ? e.message : String(e),
        },
      });
    }
  }

  return { count, total, failed };
}

export interface FailNeedOptions extends LifecycleOptions {
  actorId?: string | null;
  /** 流转原因，写入 NeedStatusLog */
  reason?: string;
}

/**
 * 未达标/被运营终止的需求：流转 FAILED → 全额退款 → 置 REFUNDED。
 *
 * - 只有征集/承诺/竞标三个阶段可以走退款终止；开发中/验收中涉及已放款项目，必须走结算。
 * - 可重入：需求停在 FAILED（例如上次退款中途失败）时再次调用会继续把剩余承诺退回。
 * - 退款未全部成功时保持 FAILED 并返回失败原因，由重试补齐，避免"标记已退款但钱没回来"。
 */
export async function failNeedAndRefund(
  needId: string,
  options: FailNeedOptions = {},
): Promise<Result<{ status: NeedStatus; refunded: RefundSummary }>> {
  const db = options.db ?? prisma;
  const gateway = options.gateway ?? createPaymentGateway();

  const need = await db.need.findUnique({
    where: { id: needId },
    select: { id: true, status: true },
  });
  if (!need) return err("需求不存在", DomainError.NOT_FOUND);

  if (need.status === NeedStatus.COMPLETED || need.status === NeedStatus.REFUNDED) {
    return ok({ status: need.status, refunded: { count: 0, total: 0n, failed: 0 } });
  }

  if (need.status !== NeedStatus.FAILED) {
    const refundable =
      need.status === NeedStatus.COLLECTING ||
      need.status === NeedStatus.PLEDGING ||
      need.status === NeedStatus.BIDDING;
    if (!refundable) {
      return err("开发中或验收中的需求请走结算流程，不能直接流拍退款", DomainError.INVALID_STATE);
    }

    const moved = await db.$transaction(async (tx) =>
      transitionNeedInTx(tx, {
        needId,
        from: need.status,
        to: NeedStatus.FAILED,
        reason: options.reason ?? "未达标流拍",
        actorId: options.actorId ?? null,
      }),
    );

    if (!moved) {
      const latest = await db.need.findUnique({
        where: { id: needId },
        select: { status: true },
      });
      if (latest?.status !== NeedStatus.FAILED) {
        return err("需求状态已变化，请刷新后重试", DomainError.INVALID_STATE);
      }
    }
  }

  const refunded = await refundNeedPledges(needId, { db, gateway });

  if (refunded.failed > 0) {
    return err(
      `有 ${refunded.failed} 笔退款未完成，需求保持「已流拍」，请稍后重试`,
      DomainError.SERVICE_UNAVAILABLE,
    );
  }

  if (refunded.count > 0) {
    const moved = await db.$transaction(async (tx) =>
      transitionNeedInTx(tx, {
        needId,
        from: NeedStatus.FAILED,
        to: NeedStatus.REFUNDED,
        reason: "承诺款已全额原路退回",
      }),
    );
    if (moved) {
      return ok({ status: NeedStatus.REFUNDED, refunded });
    }
    const latest = await db.need.findUnique({ where: { id: needId }, select: { status: true } });
    return ok({ status: latest?.status ?? NeedStatus.FAILED, refunded });
  }

  return ok({ status: NeedStatus.FAILED, refunded });
}

export interface ExpireSummary {
  expiredNeeds: number;
  refundedPledges: number;
  refundedAmount: string;
  /** 退款未完成、仍停在已流拍的需求数 */
  failedNeeds: number;
}

/**
 * 截止到期结算（F11）：
 * - 征集期到期未达票数门槛 → 流拍（无资金）
 * - 承诺期到期仍未达目标金额 → 流拍 + 全额退款
 * 由内部 cron（`POST /api/internal/cron`）或运营方手动触发。
 */
export async function expireOverdueNeeds(
  now: Date = new Date(),
  options: LifecycleOptions = {},
): Promise<ExpireSummary> {
  const db = options.db ?? prisma;

  const overdue = await db.need.findMany({
    where: {
      status: { in: [NeedStatus.COLLECTING, NeedStatus.PLEDGING] },
      deadline: { lt: now },
    },
    select: { id: true, status: true, pledgedAmount: true, targetAmount: true },
  });

  const summary: ExpireSummary = {
    expiredNeeds: 0,
    refundedPledges: 0,
    refundedAmount: "0",
    failedNeeds: 0,
  };
  let refundedTotal = 0n;

  for (const need of overdue) {
    // 已达标的需求到期不流拍，继续进入竞标
    if (
      need.status === NeedStatus.PLEDGING &&
      need.targetAmount > 0n &&
      need.pledgedAmount >= need.targetAmount
    ) {
      continue;
    }

    const res = await failNeedAndRefund(need.id, {
      ...options,
      reason: "截止时间到期未达标，系统自动流拍",
    });

    if (!res.ok) {
      summary.failedNeeds += 1;
      continue;
    }

    summary.expiredNeeds += 1;
    summary.refundedPledges += res.value.refunded.count;
    refundedTotal += res.value.refunded.total;

    await writeAudit({
      action: "ADMIN",
      target: `need:${need.id}`,
      detail: { event: "NEED_EXPIRED", refundedPledges: res.value.refunded.count },
    });
  }

  summary.refundedAmount = refundedTotal.toString();
  return summary;
}
