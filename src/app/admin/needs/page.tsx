import Link from "next/link";
import { prisma } from "@/infrastructure/prisma/client";
import { AdminTransition } from "@/components/admin/admin-transition";
import { StatusBadge } from "@/components/need/status-badge";
import { displayMoney, displayDate } from "@/lib/display";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  title: string;
  status: Parameters<typeof StatusBadge>[0]["status"];
  voteCount: number;
  pledgedAmount: bigint;
  targetAmount: bigint;
  updatedAt: Date;
  requester: { nickname: string | null };
}

export default async function AdminNeedsPage() {
  let rows: Row[] = [];
  let dbError = false;
  try {
    rows = await prisma.need.findMany({
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        status: true,
        voteCount: true,
        pledgedAmount: true,
        targetAmount: true,
        updatedAt: true,
        requester: { select: { nickname: true } },
      },
    });
  } catch {
    dbError = true;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">需求审核与流转</h2>
      <p className="mt-1 text-sm text-slate-500">
        展示最近 50 条需求。运营方可执行状态机允许的流转，非法流转会被拒绝并提示原因。
      </p>

      {dbError && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          数据库未连接，无法加载需求。
        </div>
      )}

      <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="flex items-center gap-2">
                <StatusBadge status={r.status} />
                <Link href={`/needs/${r.id}`} className="font-medium hover:underline">
                  {r.title}
                </Link>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {r.requester.nickname ?? "匿名用户"} · {r.voteCount} 票 · 承诺{" "}
                {displayMoney(r.pledgedAmount)} / {displayMoney(r.targetAmount)} ·{" "}
                {displayDate(r.updatedAt.toISOString())}
              </div>
            </div>
            <AdminTransition needId={r.id} current={r.status} />
          </div>
        ))}
        {!dbError && rows.length === 0 && (
          <div className="p-10 text-center text-sm text-slate-500">暂无需求。</div>
        )}
      </div>
    </div>
  );
}
