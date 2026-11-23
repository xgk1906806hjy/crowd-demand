import { NeedStatus, PledgeStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma/client";
import { writeAudit } from "@/domain/shared/audit";
import { ESCROW_ACCOUNT, backerAccount, postTransfer } from "@/domain/ledger/service";
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
}

/**
 * 全额退款（F11/F17）：托管账户 → 每个支持者账户，逐笔事务处理。
 * 幂等键 `refund:{pledgeId}`，重复执行不会重复退款。
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

  for (const pledge of pledges) {
    const key = `refund:${pledge.id}`;
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
  }

  return { count, total };
}

export interface ExpireSummary {
  expiredNeeds: number;
  refundedPledges: number;
  refundedAmount: string;
}

/**
 * 截止到期结算（F11）：
 * - 征集期到期未达票数门槛 → 流拍（无资金）
 * - 承诺期到期仍未达目标金额 → 流拍 + 全额退款
 * 由定时任务（BullMQ）或运营方手动触发。
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

    await db.$transaction([
      db.need.update({ where: { id: need.id }, data: { status: NeedStatus.FAILED } }),
      db.needStatusLog.create({
        data: {
          needId: need.id,
          fromStatus: need.status,
          toStatus: NeedStatus.FAILED,
          reason: "截止时间到期未达标，系统自动流拍",
          actorId: null,
        },
      }),
    ]);

    summary.expiredNeeds += 1;

    const refund = await refundNeedPledges(need.id, options);
    summary.refundedPledges += refund.count;
    refundedTotal += refund.total;

    if (refund.count > 0) {
      await db.$transaction([
        db.need.update({ where: { id: need.id }, data: { status: NeedStatus.REFUNDED } }),
        db.needStatusLog.create({
          data: {
            needId: need.id,
            fromStatus: NeedStatus.FAILED,
            toStatus: NeedStatus.REFUNDED,
            reason: "承诺款已全额原路退回",
            actorId: null,
          },
        }),
      ]);
    }

    await writeAudit({
      action: "ADMIN",
      target: `need:${need.id}`,
      detail: { event: "NEED_EXPIRED", refundedPledges: refund.count },
    });
  }

  summary.refundedAmount = refundedTotal.toString();
  return summary;
}
