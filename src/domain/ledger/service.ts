import { LedgerAccountType, LedgerDirection, type Prisma } from "@prisma/client";

/**
 * 复式账本（F10）—— 所有资金变动的唯一记账入口。
 *
 * 记账约定（账户视角）：
 * - DEBIT  资金流出该账户（余额减少）
 * - CREDIT 资金流入该账户（余额增加）
 * 每笔业务必须一借一贷，金额相等，保证全局借贷平衡。
 *
 * 金额一律为整数分（bigint），禁止浮点。
 */

export interface AccountRef {
  type: LedgerAccountType;
  id: string;
}

/** 平台托管账户（虚拟账户，对应持牌机构托管户）。 */
export const ESCROW_ACCOUNT: AccountRef = { type: LedgerAccountType.ESCROW, id: "ESCROW" };

export function backerAccount(userId: string): AccountRef {
  return { type: LedgerAccountType.BACKER, id: userId };
}

export function builderAccount(userId: string): AccountRef {
  return { type: LedgerAccountType.BUILDER, id: userId };
}

type LedgerTx = Pick<Prisma.TransactionClient, "ledgerEntry" | "$queryRaw">;

/** 计算账户当前余额（CREDIT - DEBIT）。 */
export async function balanceOf(db: LedgerTx, account: AccountRef): Promise<bigint> {
  const rows = await db.ledgerEntry.findMany({
    where: { accountType: account.type, accountId: account.id },
    select: { direction: true, amount: true },
  });
  return rows.reduce(
    (sum, row) =>
      row.direction === LedgerDirection.CREDIT ? sum + row.amount : sum - row.amount,
    0n,
  );
}

/**
 * 账本串行锁（AGENTS 第 2 节：托管账户行锁防并发超额）。
 *
 * 本系统所有资金划转都经过托管账户，因此用一把事务级咨询锁把「读余额 → 写余额快照」
 * 串行化，避免两个并发事务读到同一份余额、写出互相覆盖的 balanceAfter。
 * 锁在事务提交/回滚时自动释放，不跨请求持有。
 */
export async function lockLedger(tx: LedgerTx): Promise<void> {
  // 注意：pg_advisory_xact_lock 返回 void，Prisma 无法反序列化 void 列（P2010），
  // 因此用子查询包一层并投影出 int 列，只取副作用的锁语义。
  await tx.$queryRaw`SELECT 1::int AS locked FROM (SELECT pg_advisory_xact_lock(hashtext('crowd-demand:ledger'))) AS _lock`;
}

export interface TransferInput {
  from: AccountRef;
  to: AccountRef;
  amount: bigint;
  bizType: "PLEDGE" | "RELEASE" | "REFUND";
  bizId: string;
  /** 业务幂等键；账本内部会派生 `:out` / `:in` 两个唯一键。 */
  idempotencyKey: string;
  pledgeId?: string;
  memo?: string;
}

/**
 * 记账：一借一贷两条流水，写在同一事务内。
 * 调用方必须在数据库事务中调用，且 `amount > 0`。
 */
export async function postTransfer(tx: LedgerTx, input: TransferInput): Promise<void> {
  if (input.amount <= 0n) {
    throw new Error("记账金额必须大于 0");
  }

  await lockLedger(tx);

  const fromBalance = await balanceOf(tx, input.from);
  const toBalance = await balanceOf(tx, input.to);

  // 托管账户不允许透支：放款/退款总额不得超过已冻结在托管中的资金
  if (input.from.type === LedgerAccountType.ESCROW && fromBalance < input.amount) {
    throw new Error("托管账户余额不足，拒绝划出");
  }

  await tx.ledgerEntry.create({
    data: {
      accountType: input.from.type,
      accountId: input.from.id,
      direction: LedgerDirection.DEBIT,
      amount: input.amount,
      balanceAfter: fromBalance - input.amount,
      bizType: input.bizType,
      bizId: input.bizId,
      pledgeId: input.pledgeId,
      idempotencyKey: `${input.idempotencyKey}:out`,
      memo: input.memo,
    },
  });

  await tx.ledgerEntry.create({
    data: {
      accountType: input.to.type,
      accountId: input.to.id,
      direction: LedgerDirection.CREDIT,
      amount: input.amount,
      balanceAfter: toBalance + input.amount,
      bizType: input.bizType,
      bizId: input.bizId,
      pledgeId: input.pledgeId,
      idempotencyKey: `${input.idempotencyKey}:in`,
      memo: input.memo,
    },
  });
}
