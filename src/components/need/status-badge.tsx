import type { NeedStatus } from "@prisma/client";
import { NEED_STATUS_LABEL, NEED_STATUS_TONE } from "@/domain/need/state-machine";

/** 需求状态徽标：颜色与文案统一取自状态机模块。 */
export function StatusBadge({ status }: { status: NeedStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${NEED_STATUS_TONE[status]}`}
    >
      {NEED_STATUS_LABEL[status]}
    </span>
  );
}
