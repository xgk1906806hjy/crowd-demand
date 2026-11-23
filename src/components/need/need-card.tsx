import Link from "next/link";
import type { NeedListItemView } from "@/domain/need/query";
import { StatusBadge } from "@/components/need/status-badge";
import { Progress } from "@/components/need/progress";
import { displayMoney, daysLeft } from "@/lib/display";

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

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            承诺 {displayMoney(item.pledgedAmount)} / 目标 {displayMoney(item.targetAmount)}
          </span>
          <span>{item.progress}%</span>
        </div>
        <Progress value={item.progress} />
      </div>

      <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
        <span className="flex items-center gap-3">
          <span className="font-medium text-slate-700">{item.voteCount} 票</span>
          <span>门槛 {item.voteThreshold} 票</span>
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
