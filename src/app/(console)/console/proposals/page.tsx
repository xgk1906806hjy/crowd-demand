import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ProposalService } from "@/domain/proposal/service";
import { displayMoney, displayDate } from "@/lib/display";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "待选",
  SELECTED: "已中标",
  REJECTED: "未中选",
  WITHDRAWN: "已撤回",
};

interface MineProposal {
  id: string;
  quote: string;
  durationDays: number;
  status: string;
  createdAt: string;
  needId: string;
  needTitle: string;
  needStatus: string;
}

export default async function MyProposalsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let items: MineProposal[] = [];
  let dbError = false;
  try {
    const res = await new ProposalService().listMine(session.userId);
    if (res.ok) items = res.value.items as unknown as MineProposal[];
  } catch {
    dbError = true;
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-bold">我的提案</h1>
      <p className="mt-1 text-sm text-slate-500">
        在竞标中的需求下提交方案，发起者选定后进入开发阶段。
      </p>

      {dbError && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          数据库未连接，暂时无法加载。
        </div>
      )}

      {!dbError && items.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          还没有提交过提案。<Link href="/needs" className="text-slate-900 underline">去需求广场找需求</Link>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/needs/${item.needId}`}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400"
          >
            <div>
              <div className="font-medium">{item.needTitle}</div>
              <div className="mt-1 text-xs text-slate-500">
                {displayDate(item.createdAt)} · 工期 {item.durationDays} 天 ·{" "}
                <span
                  className={
                    item.status === "SELECTED"
                      ? "text-emerald-600"
                      : item.status === "REJECTED"
                        ? "text-slate-400"
                        : "text-violet-600"
                  }
                >
                  {STATUS_LABEL[item.status] ?? item.status}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold">{displayMoney(item.quote)}</div>
              <div className="text-xs text-slate-400">报价</div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
