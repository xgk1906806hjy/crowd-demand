import Link from "next/link";
import { getSession } from "@/lib/auth";
import { NeedQueryService } from "@/domain/need/query";
import { NeedCard } from "@/components/need/need-card";
import type { NeedListItemView } from "@/domain/need/query";
import { ClueService, type ClueView } from "@/domain/clue/service";

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

  let clues: ClueView[] = [];
  try {
    clues = await new ClueService().top(10);
  } catch {
    dbError = true;
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-14">
      <section className="text-center">
        <h1 className="text-4xl font-bold tracking-tight">需求社 · crowd-demand</h1>
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
        <section className="mt-14">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">需求热榜</h2>
            <Link href="/trending" className="text-sm text-slate-500 hover:text-slate-900">
              查看完整热榜 →
            </Link>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            定时采集公开渠道的需求表达，同一痛点自动合并计数，按提及人数排序
          </p>
          {clues.length === 0 ? (
            <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              还没有采集到需求线索。采集任务每小时自动运行。
            </p>
          ) : (
            <ol className="mt-4 space-y-2">
              {clues.map((c, idx) => (
                <li key={c.id}>
                  <Link
                    href="/trending"
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-slate-400"
                  >
                    <span
                      className={
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold " +
                        (idx === 0
                          ? "bg-amber-100 text-amber-700"
                          : idx === 1
                            ? "bg-slate-200 text-slate-700"
                            : idx === 2
                              ? "bg-orange-100 text-orange-700"
                              : "bg-slate-100 text-slate-500")
                      }
                    >
                      {idx + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.title}</span>
                    {c.status === "FEATURED" && (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 ring-1 ring-emerald-200">
                        运营收录
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-slate-500">
                      <span className="font-semibold text-slate-900">{c.mentionerCount} 人提及</span>
                      <span className="ml-2 hidden sm:inline">共 {c.mentionCount} 次</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
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
