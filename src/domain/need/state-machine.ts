import { NeedMode, NeedStatus } from "@prisma/client";

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

/** 是否允许从 from 流转到 to（默认按众筹模式判定，保持旧调用兼容）。 */
export function canTransition(from: NeedStatus, to: NeedStatus): boolean {
  return NEED_TRANSITIONS[from].includes(to);
}

/**
 * 模式感知的流转判定（F28）。
 *
 * 三种模式共用同一套状态枚举，但入口不同：
 * - 众筹必须先进征集（COLLECTING），不允许直接进 BIDDING，防止绕过投票与承诺门槛；
 * - 悬赏 / 无偿认领没有投票与承诺期，发布即进入 BIDDING（方案征集）。
 */
export function canTransitionForMode(
  from: NeedStatus,
  to: NeedStatus,
  mode: NeedMode,
): boolean {
  if (from === NeedStatus.DRAFT && to === NeedStatus.BIDDING) {
    return mode === NeedMode.BOUNTY || mode === NeedMode.OPEN;
  }
  if (from === NeedStatus.DRAFT && to === NeedStatus.COLLECTING) {
    return mode === NeedMode.CROWDFUND;
  }
  if (from === NeedStatus.COLLECTING || from === NeedStatus.PLEDGING) {
    // 悬赏 / 认领不存在征集与承诺阶段，一旦出现即为脏数据，禁止继续流转
    if (mode !== NeedMode.CROWDFUND) return false;
  }
  return NEED_TRANSITIONS[from].includes(to);
}

/** 模式中文名。 */
export const NEED_MODE_LABEL: Readonly<Record<NeedMode, string>> = {
  [NeedMode.CROWDFUND]: "众筹",
  [NeedMode.BOUNTY]: "悬赏",
  [NeedMode.OPEN]: "无偿认领",
};

/** 模式一句话说明（发布页与详情页展示）。 */
export const NEED_MODE_HINT: Readonly<Record<NeedMode, string>> = {
  [NeedMode.CROWDFUND]: "先征集投票、凑够付费承诺再开工，适合还没有人愿意出钱的公共需求",
  [NeedMode.BOUNTY]: "你自己出钱并预付到托管，发布后开发者直接提方案，你挑一个开工",
  [NeedMode.OPEN]: "免费发布，开发者自愿接单，不涉及资金托管",
};

/** 该模式是否需要预付悬赏金。 */
export function requiresBountyDeposit(mode: NeedMode): boolean {
  return mode === NeedMode.BOUNTY;
}

/** 该模式是否跳过投票与承诺期（发布即进入方案征集）。 */
export function skipsCrowdfunding(mode: NeedMode): boolean {
  return mode === NeedMode.BOUNTY || mode === NeedMode.OPEN;
}

/** 终态：不可再流转。 */
export function isTerminal(status: NeedStatus): boolean {
  return NEED_TRANSITIONS[status].length === 0;
}

/** 是否对外可见（草稿不可见）。 */
export function isPubliclyVisible(status: NeedStatus): boolean {
  return status !== NeedStatus.DRAFT;
}

/** 是否可投票：征集期与竞标期均可（后者仅作支持表态，不触发状态流转）。 */
export function isVotable(status: NeedStatus): boolean {
  return status === NeedStatus.COLLECTING || status === NeedStatus.BIDDING;
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
