import Link from "next/link";
import { getSession } from "@/lib/auth";
import { NeedQueryService } from "@/domain/need/query";
import { NeedCard } from "@/components/need/need-card";
import type { NeedListItemView } from "@/domain/need/query";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();

  let hot: NeedListItemView[] = [];
  let pledge: NeedListItemView[] = [];
  let dbError = false;
  try {
    const service = new NeedQueryService();
    [hot, pledge] = await Promise.all([service.top("hot", 3), service.top("pledge", 3)]);
  } catch {
    dbError = true;
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-14">
      <section className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">聚需 · crowd-demand</h1>
        <p className="mx-auto mt-4 max-w-2xl text-slate-600">
          提出真实需求，用付费承诺筛选优先级，由开发者提案竞标并交付，验收达标后放款。
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/needs" className="rounded-lg bg-slate-900 px-5 py-2.5 text-white hover:bg-slate-700">
            逛需求广场
          </Link>
          <Link
            href={session ? "/console/needs/new" : "/login"}
            className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 hover:border-slate-900"
          >
            {session ? "发布需求" : "登录后发布"}
          </Link>
        </div>
      </section>

      {dbError && (
        <div className="mx-auto mt-10 max-w-xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-sm text-amber-800">
          数据库未连接，榜单暂无数据。请先启动 PostgreSQL 并执行迁移。
        </div>
      )}

      {!dbError && (
        <section className="mt-14 grid gap-8 lg:grid-cols-2">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">热度榜</h2>
              <Link href="/needs?sort=hot" className="text-sm text-slate-500 hover:text-slate-900">
                查看全部 →
              </Link>
            </div>
            <p className="mt-1 text-xs text-slate-400">按支持票数排序，票数达标进入承诺期</p>
            <div className="mt-4 space-y-3">
              {hot.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                  暂无需求
                </p>
              ) : (
                hot.map((item) => <NeedCard key={item.id} item={item} />)
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">承诺榜</h2>
              <Link href="/needs?sort=pledge" className="text-sm text-slate-500 hover:text-slate-900">
                查看全部 →
              </Link>
            </div>
            <p className="mt-1 text-xs text-slate-400">按已到账的预购订金排序，钱比票更真实</p>
            <div className="mt-4 space-y-3">
              {pledge.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                  暂无承诺
                </p>
              ) : (
                pledge.map((item) => <NeedCard key={item.id} item={item} />)
              )}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
