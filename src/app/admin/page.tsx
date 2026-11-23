import Link from "next/link";
import { NeedStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma/client";
import { displayMoney } from "@/lib/display";
import { LedgerQueryService } from "@/domain/ledger/query";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  let counts: Array<{ label: string; value: number }> = [];
  let pendingReports = 0;
  let escrow = "0";
  let dbError = false;

  try {
    const [collecting, pledging, bidding, inProgress, accepting, completed, reports, ledger] =
      await Promise.all([
        prisma.need.count({ where: { status: NeedStatus.COLLECTING } }),
        prisma.need.count({ where: { status: NeedStatus.PLEDGING } }),
        prisma.need.count({ where: { status: NeedStatus.BIDDING } }),
        prisma.need.count({ where: { status: NeedStatus.IN_PROGRESS } }),
        prisma.need.count({ where: { status: NeedStatus.ACCEPTING } }),
        prisma.need.count({ where: { status: NeedStatus.COMPLETED } }),
        prisma.report.count({ where: { status: "PENDING" } }),
        new LedgerQueryService().overview(1),
      ]);

    counts = [
      { label: "征集中", value: collecting },
      { label: "承诺中", value: pledging },
      { label: "竞标中", value: bidding },
      { label: "开发中", value: inProgress },
      { label: "验收中", value: accepting },
      { label: "已完成", value: completed },
    ];
    pendingReports = reports;
    if (ledger.ok) escrow = ledger.value.escrowBalance;
  } catch {
    dbError = true;
  }

  return (
    <div>
      {dbError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          数据库未连接，无法加载运营数据。
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">托管账户余额</div>
          <div className="mt-2 text-2xl font-bold">{displayMoney(escrow)}</div>
          <Link href="/admin/ledger" className="mt-2 inline-block text-xs text-slate-500 underline">
            查看流水
          </Link>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">待处理举报</div>
          <div className="mt-2 text-2xl font-bold">{pendingReports}</div>
          <Link href="/admin/reports" className="mt-2 inline-block text-xs text-slate-500 underline">
            去处理
          </Link>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="text-xs text-slate-500">到期结算</div>
          <div className="mt-2 text-sm text-slate-600">
            `POST /api/admin/needs/expire` 触发（生产由定时任务执行）
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-6">
        {counts.map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-4 text-center">
            <div className="text-xs text-slate-500">{c.label}</div>
            <div className="mt-1 text-xl font-semibold">{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
