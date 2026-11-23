import { MilestoneStatus, NeedStatus, PledgeStatus, type Prisma } from "@prisma/client";
import {
  ESCROW_ACCOUNT,
  backerAccount,
  builderAccount,
  postTransfer,
} from "@/domain/ledger/service";
import { transitionNeedInTx } from "@/domain/need/transition";

/**
 * 放款与结算（F16/F17）—— 只接受事务客户端，保证与验收状态同事务提交。
 *
 * 外部资金划转（PaymentGateway）由调用方在事务外按幂等 reference 完成，
 * 这里只负责「记账 + 业务落库 + 支付单留痕」，不直接调用支付 SDK。
 */

export interface ReleaseInput {
  projectId: string;
  milestoneId: string;
  needId: string;
  payeeId: string;
  amount: bigint;
  /** 托管方放款流水号（外部调用成功后的回执） */
  gatewayRef: string | null;
  /** 实际支付适配器标识，禁止硬编码 mock */
  provider: string;
}

/** 里程碑放款：托管 → 开发者，写 Payout、支付单与账本，项目已释放金额自增。 */
export async function releaseMilestoneInTx(
  tx: Prisma.TransactionClient,
  input: ReleaseInput,
): Promise<string> {
  if (input.amount <= 0n) throw new Error("放款金额必须大于 0");

  const key = `payout:${input.milestoneId}`;

  await postTransfer(tx, {
    from: ESCROW_ACCOUNT,
    to: builderAccount(input.payeeId),
    amount: input.amount,
    bizType: "RELEASE",
    bizId: input.milestoneId,
    idempotencyKey: key,
    memo: "里程碑验收通过放款",
  });

  const payout = await tx.payout.create({
    data: {
      projectId: input.projectId,
      milestoneId: input.milestoneId,
      payeeId: input.payeeId,
      amount: input.amount,
      status: "SUCCESS",
      idempotencyKey: key,
      gatewayRef: input.gatewayRef,
    },
    select: { id: true },
  });

  await tx.paymentOrder.create({
    data: {
      idempotencyKey: key,
      type: "RELEASE",
      amount: input.amount,
      status: "SUCCESS",
      gateway: input.provider,
      gatewayRef: input.gatewayRef,
      payload: {
        projectId: input.projectId,
        milestoneId: input.milestoneId,
        payeeId: input.payeeId,
      },
    },
  });

  await tx.milestone.update({
    where: { id: input.milestoneId },
    data: { status: MilestoneStatus.RELEASED },
  });

  await tx.project.update({
    where: { id: input.projectId },
    data: { releasedAmount: { increment: input.amount } },
  });

  return payout.id;
}

export interface RefundReceipt {
  pledgeId: string;
  ref: string | null;
}

export interface SettleInput {
  projectId: string;
  needId: string;
  /** 项目托管总额（分） */
  totalAmount: bigint;
  /** 中标报价（分） */
  quote: bigint;
  /** 外部退款回执：pledgeId → 托管方流水号（事务外已调用 PaymentGateway） */
  refunds?: RefundReceipt[];
  provider: string;
  actorId?: string;
}

/**
 * 最终结算（F17）：
 * 1. 托管总额中超出报价的部分，按承诺金额比例退回支持者；
 * 2. 全部承诺置为已放款；
 * 3. 项目完成、需求进入已完成（走状态机唯一入口）。
 */
export async function settleProjectInTx(
  tx: Prisma.TransactionClient,
  input: SettleInput,
): Promise<{ refunded: bigint }> {
  const leftover = input.totalAmount > input.quote ? input.totalAmount - input.quote : 0n;
  const receiptByPledge = new Map((input.refunds ?? []).map((r) => [r.pledgeId, r.ref]));
  let refunded = 0n;

  const pledges = await tx.pledge.findMany({
    where: { needId: input.needId, status: { in: [PledgeStatus.FROZEN, PledgeStatus.LOCKED] } },
    select: { id: true, userId: true, amount: true },
  });

  if (leftover > 0n && pledges.length > 0) {
    const totalPledged = pledges.reduce((sum, p) => sum + p.amount, 0n);

    for (let i = 0; i < pledges.length; i += 1) {
      const pledge = pledges[i];
      if (!pledge) continue;

      // 最后一笔承接除不尽的余数，保证总额精确
      const isLast = i === pledges.length - 1;
      const share = isLast
        ? leftover - refunded
        : (leftover * pledge.amount) / totalPledged;

      if (share > 0n) {
        const key = `settle:${pledge.id}`;
        await postTransfer(tx, {
          from: ESCROW_ACCOUNT,
          to: backerAccount(pledge.userId),
          amount: share,
          bizType: "REFUND",
          bizId: key,
          idempotencyKey: key,
          pledgeId: pledge.id,
          memo: "结算剩余款按承诺比例退回",
        });
        await tx.paymentOrder.create({
          data: {
            idempotencyKey: key,
            type: "REFUND",
            amount: share,
            status: "SUCCESS",
            gateway: input.provider,
            gatewayRef: receiptByPledge.get(pledge.id) ?? null,
            payload: { projectId: input.projectId, pledgeId: pledge.id, kind: "SETTLE_LEFTOVER" },
          },
        });
        refunded += share;
      }

      await tx.pledge.update({
        where: { id: pledge.id },
        data: { status: PledgeStatus.RELEASED },
      });
    }
  } else {
    await tx.pledge.updateMany({
      where: {
        needId: input.needId,
        status: { in: [PledgeStatus.FROZEN, PledgeStatus.LOCKED] },
      },
      data: { status: PledgeStatus.RELEASED },
    });
  }

  await tx.project.update({
    where: { id: input.projectId },
    data: { status: "COMPLETED" },
  });

  const moved = await transitionNeedInTx(tx, {
    needId: input.needId,
    from: NeedStatus.ACCEPTING,
    to: NeedStatus.COMPLETED,
    reason: "全部里程碑验收通过，项目完成",
    actorId: input.actorId ?? null,
  });
  if (!moved) {
    const current = await tx.need.findUnique({
      where: { id: input.needId },
      select: { status: true },
    });
    if (current?.status !== NeedStatus.COMPLETED) {
      throw new Error("需求状态不是验收中，无法结算");
    }
  }

  return { refunded };
}
