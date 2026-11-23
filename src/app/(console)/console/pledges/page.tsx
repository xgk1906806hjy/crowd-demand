import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { PledgeService } from "@/domain/pledge/service";
import { displayMoney, displayDate } from "@/lib/display";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  FROZEN: "托管中",
  LOCKED: "已锁定",
  RELEASED: "已放款",
  REFUNDED: "已退款",
};

interface MinePledge {
  id: string;
  amount: string;
  status: string;
  createdAt: string;
  needId: string;
  needTitle: string;
  needStatus: string;
}

export default async function MyPledgesPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let items: MinePledge[] = [];
  let dbError = false;
  try {
    const res = await new PledgeService().listMine(session.userId);
    if (res.ok) items = res.value.items as unknown as MinePledge[];
  } catch {
    dbError = true;
  }

  const active = items.filter((i) => i.status === "FROZEN" || i.status === "LOCKED");
  const activeTotal = active.reduce((sum, i) => sum + BigInt(i.amount), 0n);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-bold">我的承诺</h1>
      <p className="mt-1 text-sm text-slate-500">
        托管中 {active.length} 笔，合计 {displayMoney(activeTotal)}
      </p>

      {dbError && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          数据库未连接，暂时无法加载。
        </div>
      )}

      {!dbError && items.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          还没有承诺过任何需求。<Link href="/needs" className="text-slate-900 underline">去需求广场看看</Link>
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
                {displayDate(item.createdAt)} · {STATUS_LABEL[item.status] ?? item.status}
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold">{displayMoney(item.amount)}</div>
              <div className="text-xs text-slate-400">预购订金</div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
