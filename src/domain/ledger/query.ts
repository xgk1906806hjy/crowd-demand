import { LedgerAccountType, LedgerDirection } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma/client";
import { ESCROW_ACCOUNT, balanceOf } from "@/domain/ledger/service";
import { ok, type Result } from "@/domain/shared/result";

export interface LedgerEntryView {
  id: string;
  accountType: string;
  accountId: string;
  direction: string;
  amount: string;
  balanceAfter: string;
  bizType: string;
  bizId: string;
  memo: string | null;
  createdAt: string;
}

export interface LedgerOverview {
  escrowBalance: string;
  totalPledged: string;
  totalReleased: string;
  totalRefunded: string;
  entries: LedgerEntryView[];
}

/** 资金流水与托管状态查看（F19，运营方）。 */
export class LedgerQueryService {
  constructor(private readonly db: typeof prisma = prisma) {}

  async overview(limit = 100): Promise<Result<LedgerOverview>> {
    const [escrowBalance, rows] = await Promise.all([
      balanceOf(this.db, ESCROW_ACCOUNT),
      this.db.ledgerEntry.findMany({
        orderBy: { createdAt: "desc" },
        take: Math.min(200, Math.max(1, limit)),
        select: {
          id: true,
          accountType: true,
          accountId: true,
          direction: true,
          amount: true,
          balanceAfter: true,
          bizType: true,
          bizId: true,
          memo: true,
          createdAt: true,
        },
      }),
    ]);

    // 汇总按托管账户口径：承诺流入、放款流出、退款流出
    let totalPledged = 0n;
    let totalReleased = 0n;
    let totalRefunded = 0n;
    for (const row of rows) {
      if (row.accountType !== LedgerAccountType.ESCROW) continue;
      if (row.bizType === "PLEDGE" && row.direction === LedgerDirection.CREDIT) {
        totalPledged += row.amount;
      } else if (row.bizType === "RELEASE" && row.direction === LedgerDirection.DEBIT) {
        totalReleased += row.amount;
      } else if (row.bizType === "REFUND" && row.direction === LedgerDirection.DEBIT) {
        totalRefunded += row.amount;
      }
    }

    return ok({
      escrowBalance: escrowBalance.toString(),
      totalPledged: totalPledged.toString(),
      totalReleased: totalReleased.toString(),
      totalRefunded: totalRefunded.toString(),
      entries: rows.map((r) => ({
        id: r.id,
        accountType: r.accountType,
        accountId: r.accountId,
        direction: r.direction,
        amount: r.amount.toString(),
        balanceAfter: r.balanceAfter.toString(),
        bizType: r.bizType,
        bizId: r.bizId,
        memo: r.memo,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  }
}
