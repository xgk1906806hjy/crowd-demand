import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { NeedService } from "@/domain/need/service";
import { StatusBadge } from "@/components/need/status-badge";
import type { NeedStatus } from "@prisma/client";
import { displayMoney, displayDate } from "@/lib/display";

export const dynamic = "force-dynamic";

interface MineItem {
  id: string;
  title: string;
  status: NeedStatus;
  statusLabel: string;
  voteCount: number;
  voteThreshold: number;
  targetAmount: string;
  pledgedAmount: string;
  publishedAt: string | null;
  createdAt: string;
}

export default async function MyNeedsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let items: MineItem[] = [];
  let dbError = false;
  try {
    const res = await new NeedService().listMine(session.userId);
    if (res.ok) items = res.value.items as unknown as MineItem[];
  } catch {
    dbError = true;
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">我的需求</h1>
          <p className="mt-1 text-sm text-slate-500">共 {items.length} 条</p>
        </div>
        <Link
          href="/console/needs/new"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
        >
          发布需求
        </Link>
      </div>

      {dbError && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          数据库未连接，暂时无法加载。
        </div>
      )}

      {!dbError && items.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          还没有发布过需求。
        </div>
      )}

      <div className="mt-6 space-y-3">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/needs/${item.id}`}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400"
          >
            <div>
              <div className="flex items-center gap-2">
                <StatusBadge status={item.status} />
                <span className="text-xs text-slate-400">{displayDate(item.publishedAt ?? item.createdAt)}</span>
              </div>
              <div className="mt-1 font-medium">{item.title}</div>
              <div className="mt-1 text-xs text-slate-500">
                {item.voteCount}/{item.voteThreshold} 票 · 已承诺 {displayMoney(item.pledgedAmount)} /{" "}
                {displayMoney(item.targetAmount)}
              </div>
            </div>
            <span className="text-sm text-slate-400">→</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
