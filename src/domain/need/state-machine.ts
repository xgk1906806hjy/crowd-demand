import { NeedStatus } from "@prisma/client";

/**
 * 需求生命周期状态机（F06）—— 全项目唯一的流转真相来源。
 * UI 与接口层禁止自行判断状态，一律调用本模块。
 */
export const NEED_TRANSITIONS: Readonly<Record<NeedStatus, readonly NeedStatus[]>> = {
  [NeedStatus.DRAFT]: [NeedStatus.COLLECTING],
  [NeedStatus.COLLECTING]: [NeedStatus.PLEDGING, NeedStatus.FAILED],
  [NeedStatus.PLEDGING]: [NeedStatus.BIDDING, NeedStatus.FAILED],
  [NeedStatus.BIDDING]: [NeedStatus.IN_PROGRESS, NeedStatus.FAILED],
  [NeedStatus.IN_PROGRESS]: [NeedStatus.ACCEPTING, NeedStatus.FAILED],
  [NeedStatus.ACCEPTING]: [NeedStatus.COMPLETED, NeedStatus.REFUNDED],
  [NeedStatus.COMPLETED]: [],
  [NeedStatus.FAILED]: [NeedStatus.REFUNDED],
  [NeedStatus.REFUNDED]: [],
};

/** 状态中文名（UI 展示统一取这里，避免各处硬编码）。 */
export const NEED_STATUS_LABEL: Readonly<Record<NeedStatus, string>> = {
  [NeedStatus.DRAFT]: "草稿",
  [NeedStatus.COLLECTING]: "征集中",
  [NeedStatus.PLEDGING]: "承诺中",
  [NeedStatus.BIDDING]: "竞标中",
  [NeedStatus.IN_PROGRESS]: "开发中",
  [NeedStatus.ACCEPTING]: "验收中",
  [NeedStatus.COMPLETED]: "已完成",
  [NeedStatus.FAILED]: "已流拍",
  [NeedStatus.REFUNDED]: "已退款",
};

/** 状态对应的展示色（Tailwind 类）。 */
export const NEED_STATUS_TONE: Readonly<Record<NeedStatus, string>> = {
  [NeedStatus.DRAFT]: "bg-slate-100 text-slate-600",
  [NeedStatus.COLLECTING]: "bg-blue-50 text-blue-700",
  [NeedStatus.PLEDGING]: "bg-amber-50 text-amber-700",
  [NeedStatus.BIDDING]: "bg-violet-50 text-violet-700",
  [NeedStatus.IN_PROGRESS]: "bg-emerald-50 text-emerald-700",
  [NeedStatus.ACCEPTING]: "bg-cyan-50 text-cyan-700",
  [NeedStatus.COMPLETED]: "bg-green-50 text-green-700",
  [NeedStatus.FAILED]: "bg-slate-100 text-slate-500",
  [NeedStatus.REFUNDED]: "bg-rose-50 text-rose-700",
};

/** 是否允许从 from 流转到 to。 */
export function canTransition(from: NeedStatus, to: NeedStatus): boolean {
  return NEED_TRANSITIONS[from].includes(to);
}

/** 终态：不可再流转。 */
export function isTerminal(status: NeedStatus): boolean {
  return NEED_TRANSITIONS[status].length === 0;
}

/** 是否对外可见（草稿不可见）。 */
export function isPubliclyVisible(status: NeedStatus): boolean {
  return status !== NeedStatus.DRAFT;
}

/** 是否可投票：仅征集期。 */
export function isVotable(status: NeedStatus): boolean {
  return status === NeedStatus.COLLECTING;
}

/** 是否可付费承诺：征集达标后进入承诺期。 */
export function isPledgeable(status: NeedStatus): boolean {
  return status === NeedStatus.PLEDGING;
}

/** 平台进行中状态集合（列表默认展示口径）。 */
export const ACTIVE_STATUSES: readonly NeedStatus[] = [
  NeedStatus.COLLECTING,
  NeedStatus.PLEDGING,
  NeedStatus.BIDDING,
  NeedStatus.IN_PROGRESS,
  NeedStatus.ACCEPTING,
];

/** 列表筛选项（值与中文名）。 */
export const NEED_FILTERS: readonly { value: string; label: string }[] = [
  { value: "ALL", label: "全部" },
  { value: NeedStatus.COLLECTING, label: "征集中" },
  { value: NeedStatus.PLEDGING, label: "承诺中" },
  { value: NeedStatus.BIDDING, label: "竞标中" },
  { value: NeedStatus.IN_PROGRESS, label: "开发中" },
  { value: NeedStatus.COMPLETED, label: "已完成" },
];
