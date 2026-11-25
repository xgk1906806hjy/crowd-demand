import Link from "next/link";
import type { NeedListItemView } from "@/domain/need/query";
import { StatusBadge } from "@/components/need/status-badge";
import { Progress } from "@/components/need/progress";
import { displayMoney, daysLeft } from "@/lib/display";

const MODE_TAG: Record<string, string> = {
  BOUNTY: "bg-amber-100 text-amber-700",
  OPEN: "bg-emerald-100 text-emerald-700",
  CROWDFUND: "bg-slate-100 text-slate-600",
};

export function NeedCard({ item }: { item: NeedListItemView }) {
  const left = daysLeft(item.deadline);

  return (
    <Link
      href={`/needs/${item.id}`}
      className="block rounded-xl border border-slate-200 bg-white p-5 transition hover:border-slate-400"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold leading-6">{item.title}</h3>
        <StatusBadge status={item.status} />
      </div>

      <p className="mt-2 line-clamp-2 text-sm text-slate-600">{item.summary}</p>

      {item.mode === "CROWDFUND" ? (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              承诺 {displayMoney(item.pledgedAmount)} / 目标 {displayMoney(item.targetAmount)}
            </span>
            <span>{item.progress}%</span>
          </div>
          <Progress value={item.progress} />
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
          <span className="font-medium text-slate-700">
            {item.mode === "BOUNTY" ? `悬赏 ${displayMoney(item.bountyAmount)}` : "无偿求助"}
          </span>
          <span className="text-slate-500">
            {item.mode === "BOUNTY" ? "已全额托管" : "开发者自愿接单"}
          </span>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
        <span className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 ${MODE_TAG[item.mode] ?? MODE_TAG.CROWDFUND}`}>
            {item.modeLabel}
          </span>
          {item.mode === "CROWDFUND" ? (
            <span className="font-medium text-slate-700">{item.voteCount} 票</span>
          ) : null}
        </span>
        <span className="flex items-center gap-3">
          <span>{item.requesterName}</span>
          {left !== null && (
            <span className={left <= 3 ? "text-rose-600" : ""}>
              {left > 0 ? `剩 ${left} 天` : "已截止"}
            </span>
          )}
        </span>
      </div>
    </Link>
  );
}
