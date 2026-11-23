import Link from "next/link";
import { NeedQueryService, NEED_SORTS, SORT_LABEL, normalizeSort } from "@/domain/need/query";
import { NEED_FILTERS } from "@/domain/need/state-machine";
import { NeedCard } from "@/components/need/need-card";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | null {
  return typeof v === "string" ? v : null;
}

function buildHref(params: {
  sort: string;
  status: string;
  keyword: string | null;
  page?: number;
}): string {
  const sp = new URLSearchParams();
  if (params.sort !== "hot") sp.set("sort", params.sort);
  if (params.status !== "ALL") sp.set("status", params.status);
  if (params.keyword) sp.set("keyword", params.keyword);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `/needs?${qs}` : "/needs";
}

export default async function NeedsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const sort = normalizeSort(one(sp.sort));
  const status = one(sp.status) ?? "ALL";
  const keyword = one(sp.keyword)?.trim() || null;
  const page = Math.max(1, Number(one(sp.page) ?? 1) || 1);

  let items: Awaited<ReturnType<NeedQueryService["top"]>> = [];
  let total = 0;
  let pageSize = 12;
  let dbError = false;

  try {
    const res = await new NeedQueryService().list({ sort, status, keyword, page });
    if (res.ok) {
      items = res.value.items;
      total = res.value.total;
      pageSize = res.value.pageSize;
    }
  } catch {
    dbError = true;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">需求广场</h1>
          <p className="mt-1 text-sm text-slate-500">
            票数决定需求是否进入承诺期，付费承诺金额决定开发优先级。
          </p>
        </div>
        <form action="/needs" className="flex items-center gap-2">
          <input type="hidden" name="sort" value={sort} />
          <input
            name="keyword"
            defaultValue={keyword ?? ""}
            placeholder="搜索需求关键词"
            className="w-56 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-900"
          />
          <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:border-slate-900">
            搜索
          </button>
        </form>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1 rounded-lg bg-white p-1 ring-1 ring-slate-200">
          {NEED_SORTS.map((s) => (
            <Link
              key={s}
              href={buildHref({ sort: s, status, keyword })}
              className={`rounded-md px-3 py-1.5 text-sm ${
                s === sort ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {SORT_LABEL[s]}
            </Link>
          ))}
        </nav>

        <nav className="flex flex-wrap gap-3 text-sm">
          {NEED_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={buildHref({ sort, status: f.value, keyword })}
              className={f.value === status ? "font-medium text-slate-900" : "text-slate-500 hover:text-slate-900"}
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </div>

      {dbError && (
        <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          数据库未连接，暂时无法加载需求。请先执行 <code className="font-mono">docker compose up -d</code> 并运行迁移。
        </div>
      )}

      {!dbError && items.length === 0 && (
        <div className="mt-10 rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-sm text-slate-500">
            {keyword ? "没有匹配的需求，换个关键词试试。" : "还没有公开需求，成为第一个提出需求的人。"}
          </p>
          <Link
            href="/console/needs/new"
            className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
          >
            发布第一个需求
          </Link>
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <NeedCard key={item.id} item={item} />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-3 text-sm">
          {page > 1 ? (
            <Link
              href={buildHref({ sort, status, keyword, page: page - 1 })}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:border-slate-900"
            >
              上一页
            </Link>
          ) : (
            <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-300">上一页</span>
          )}
          <span className="text-slate-500">
            第 {page} / {totalPages} 页 · 共 {total} 条
          </span>
          {page < totalPages ? (
            <Link
              href={buildHref({ sort, status, keyword, page: page + 1 })}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:border-slate-900"
            >
              下一页
            </Link>
          ) : (
            <span className="rounded-lg border border-slate-200 px-3 py-1.5 text-slate-300">下一页</span>
          )}
        </div>
      )}
    </main>
  );
}
