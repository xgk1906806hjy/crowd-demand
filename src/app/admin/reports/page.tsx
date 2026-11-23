import Link from "next/link";
import { ReportService } from "@/domain/report/service";
import { ReportHandleButtons } from "@/components/admin/report-handle-buttons";
import { displayDateTime } from "@/lib/display";

export const dynamic = "force-dynamic";

const TARGET_LABEL: Record<string, string> = {
  NEED: "需求",
  PROPOSAL: "提案",
  USER: "用户",
};

export default async function AdminReportsPage() {
  let items: Awaited<ReturnType<ReportService["listPending"]>> = [];
  let dbError = false;
  try {
    items = await new ReportService().listPending();
  } catch {
    dbError = true;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">待处理举报</h2>
      <p className="mt-1 text-sm text-slate-500">按提交时间升序，共 {items.length} 条。</p>

      {dbError && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          数据库未连接，无法加载举报。
        </div>
      )}

      {!dbError && items.length === 0 && (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          暂无待处理举报。
        </div>
      )}

      <div className="mt-4 space-y-3">
        {items.map((r) => (
          <article key={r.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-medium">
                  {TARGET_LABEL[r.targetType] ?? r.targetType} · {r.targetId}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{r.reason}</p>
                <div className="mt-1 text-xs text-slate-400">
                  举报人 {r.reporterId} · {displayDateTime(r.createdAt)}
                </div>
              </div>
              <ReportHandleButtons reportId={r.id} />
            </div>
            {r.targetType === "NEED" && (
              <Link href={`/needs/${r.targetId}`} className="mt-2 inline-block text-xs underline">
                查看被举报需求
              </Link>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
