import Link from "next/link";
import { ClueService, type ClueView } from "@/domain/clue/service";
import { displayDateTime } from "@/lib/display";

export const dynamic = "force-dynamic";

export default async function TrendingPage() {
  let items: ClueView[] = [];
  let dbError = false;
  try {
    items = await new ClueService().top(30);
  } catch {
    dbError = true;
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-bold">需求热榜</h1>
      <p className="mt-1 text-sm text-slate-500">
        平台定时采集公开渠道里的需求表达，同一痛点自动合并计数，按「提及人数」排序。
        只保留公开内容与来源链接，不存储个人信息。
      </p>

      {dbError && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          数据库未连接，暂时无法加载。
        </div>
      )}

      {!dbError && items.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          还没有采集到需求线索。采集任务每小时自动运行，运营也可在后台手动触发。
        </div>
      )}

      <ol className="mt-6 space-y-3">
        {items.map((item, idx) => (
          <li
            key={item.id}
            className="rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="flex items-start gap-4">
              <span
                className={
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold " +
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
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.title}</span>
                  {item.status === "FEATURED" && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 ring-1 ring-emerald-200">
                      运营收录
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-600">{item.summary}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="font-semibold text-slate-900">
                    {item.mentionerCount} 人提及
                  </span>
                  <span>共 {item.mentionCount} 次</span>
                  <span>最近 {displayDateTime(item.lastSeenAt)}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    来源：
                    {item.sources.map((s) => (
                      <a
                        key={s.sourceKey}
                        href={s.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 hover:bg-slate-200"
                      >
                        {s.name} ↗
                      </a>
                    ))}
                  </span>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-8 text-sm text-slate-500">
        看到你也有的痛点？<Link href="/console" className="text-slate-900 underline">去控制台发布成正式需求</Link>
        ，让它进入投票与承诺流程。
      </p>
    </main>
  );
}
