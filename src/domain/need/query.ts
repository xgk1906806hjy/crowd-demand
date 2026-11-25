import {
  KycStatus,
  NeedMode,
  NeedStatus,
  UserRole,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/infrastructure/prisma/client";
import { ok, err, DomainError, type Result } from "@/domain/shared/result";
import {
  NEED_MODE_LABEL,
  NEED_STATUS_LABEL,
  isPubliclyVisible,
  isVotable,
} from "@/domain/need/state-machine";

/** 榜单排序口径（F08）。 */
export const NEED_SORTS = ["hot", "pledge", "latest", "deadline"] as const;
export type NeedSort = (typeof NEED_SORTS)[number];

export const SORT_LABEL: Readonly<Record<NeedSort, string>> = {
  hot: "热度榜",
  pledge: "承诺榜",
  latest: "最新发布",
  deadline: "即将截止",
};

export function normalizeSort(raw: string | null | undefined): NeedSort {
  return (NEED_SORTS as readonly string[]).includes(raw ?? "") ? (raw as NeedSort) : "hot";
}

/** 排序规则集中定义，禁止在页面里拼 orderBy。 */
export function buildNeedOrderBy(sort: NeedSort): Prisma.NeedOrderByWithRelationInput[] {
  switch (sort) {
    case "pledge":
      return [{ pledgedAmount: "desc" }, { voteCount: "desc" }, { id: "asc" }];
    case "latest":
      return [{ publishedAt: "desc" }, { id: "asc" }];
    case "deadline":
      return [{ deadline: "asc" }, { voteCount: "desc" }, { id: "asc" }];
    case "hot":
    default:
      return [{ voteCount: "desc" }, { publishedAt: "desc" }, { id: "asc" }];
  }
}

/** 承诺进度百分比（仅展示用，保留 1 位小数）。 */
export function computeProgress(pledged: bigint, target: bigint): number {
  if (target <= 0n) return 0;
  const ratio = (Number(pledged) / Number(target)) * 100;
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(999.9, Math.round(ratio * 10) / 10);
}

export interface NeedListQuery {
  sort?: string | null;
  status?: string | null;
  keyword?: string | null;
  page?: number;
  pageSize?: number;
}

export interface NeedListItemView {
  id: string;
  title: string;
  summary: string;
  status: NeedStatus;
  statusLabel: string;
  /** 需求模式（F28）：CROWDFUND 众筹 / BOUNTY 悬赏 / OPEN 无偿认领 */
  mode: NeedMode;
  modeLabel: string;
  /** 悬赏金额（分），非悬赏模式为 "0" */
  bountyAmount: string;
  voteCount: number;
  voteThreshold: number;
  targetAmount: string;
  pledgedAmount: string;
  progress: number;
  deadline: string | null;
  publishedAt: string | null;
  requesterName: string;
}

export interface NeedDetailView extends NeedListItemView {
  /** 方案征集截止时间（悬赏 / 认领模式） */
  bountyDeadline: string | null;
  description: string;
  targetAudience: string | null;
  expectedForm: string | null;
  attachments: string[];
  createdAt: string;
  requesterId: string;
  statusLogs: Array<{
    id: string;
    fromStatus: NeedStatus | null;
    toStatus: NeedStatus;
    reason: string | null;
    createdAt: string;
  }>;
  viewer: {
    loggedIn: boolean;
    isRequester: boolean;
    kycVerified: boolean;
    isBuilder: boolean;
    hasVoted: boolean;
    canVote: boolean;
  };
}

function toSummary(description: string, max = 110): string {
  const flat = description.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

function toListItem(n: {
  id: string;
  title: string;
  description: string;
  status: NeedStatus;
  mode: NeedMode;
  bountyAmount: bigint;
  voteCount: number;
  voteThreshold: number;
  targetAmount: bigint;
  pledgedAmount: bigint;
  deadline: Date | null;
  publishedAt: Date | null;
  requester: { nickname: string | null };
}): NeedListItemView {
  return {
    id: n.id,
    title: n.title,
    summary: toSummary(n.description),
    status: n.status,
    statusLabel: NEED_STATUS_LABEL[n.status],
    mode: n.mode,
    modeLabel: NEED_MODE_LABEL[n.mode],
    bountyAmount: n.bountyAmount.toString(),
    voteCount: n.voteCount,
    voteThreshold: n.voteThreshold,
    targetAmount: n.targetAmount.toString(),
    pledgedAmount: n.pledgedAmount.toString(),
    progress: computeProgress(n.pledgedAmount, n.targetAmount),
    deadline: n.deadline?.toISOString() ?? null,
    publishedAt: n.publishedAt?.toISOString() ?? null,
    // 昵称脱敏由 F01 未设置昵称时回退，不暴露手机号
    requesterName: n.requester.nickname ?? "匿名用户",
  };
}

export class NeedQueryService {
  constructor(private readonly db: typeof prisma = prisma) {}

  /** 需求列表（F05）与榜单（F08）。 */
  async list(
    query: NeedListQuery = {},
  ): Promise<Result<{ items: NeedListItemView[]; total: number; page: number; pageSize: number }>> {
    const sort = normalizeSort(query.sort);
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Math.floor(query.pageSize ?? 12)));

    const statusFilter = query.status?.trim().toUpperCase() ?? null;
    if (statusFilter && statusFilter !== "ALL" && !(statusFilter in NeedStatus)) {
      return err("不支持的状态筛选条件", DomainError.VALIDATION);
    }

    const where: Prisma.NeedWhereInput = {
      status:
        statusFilter && statusFilter !== "ALL" ? (statusFilter as NeedStatus) : { not: NeedStatus.DRAFT },
    };

    const keyword = query.keyword?.trim();
    if (keyword) {
      if (keyword.length > 50) {
        return err("搜索关键词过长", DomainError.VALIDATION);
      }
      where.OR = [
        { title: { contains: keyword, mode: "insensitive" } },
        { description: { contains: keyword, mode: "insensitive" } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.db.need.findMany({
        where,
        orderBy: buildNeedOrderBy(sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          voteCount: true,
          voteThreshold: true,
          mode: true,
          bountyAmount: true,
          bountyDeadline: true,
          targetAmount: true,
          pledgedAmount: true,
          deadline: true,
          publishedAt: true,
          requester: { select: { nickname: true } },
        },
      }),
      this.db.need.count({ where }),
    ]);

    return ok({ items: rows.map(toListItem), total, page, pageSize });
  }

  /** 首页榜单（F08）：按给定口径取前 N 条。 */
  async top(sort: NeedSort, limit = 6): Promise<NeedListItemView[]> {
    const res = await this.list({ sort, pageSize: limit, status: "ALL" });
    return res.ok ? res.value.items : [];
  }

  /** 需求详情（F05）。草稿仅发起者可见。 */
  async detail(needId: string, viewerId?: string | null): Promise<Result<NeedDetailView>> {
    const need = await this.db.need.findUnique({
      where: { id: needId },
      select: {
        id: true,
        title: true,
        description: true,
        targetAudience: true,
        expectedForm: true,
        attachments: true,
        status: true,
        voteCount: true,
        voteThreshold: true,
        mode: true,
        bountyAmount: true,
        bountyDeadline: true,
        targetAmount: true,
        pledgedAmount: true,
        deadline: true,
        publishedAt: true,
        createdAt: true,
        requesterId: true,
        requester: { select: { nickname: true } },
        statusLogs: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, fromStatus: true, toStatus: true, reason: true, createdAt: true },
        },
      },
    });

    if (!need) return err("需求不存在", DomainError.NOT_FOUND);

    const isRequester = viewerId != null && viewerId === need.requesterId;
    if (!isPubliclyVisible(need.status) && !isRequester) {
      return err("需求不存在", DomainError.NOT_FOUND);
    }

    let kycVerified = false;
    let hasVoted = false;
    let isBuilder = false;
    if (viewerId) {
      const [user, vote] = await Promise.all([
        this.db.user.findUnique({
          where: { id: viewerId },
          select: { kycStatus: true, roles: true },
        }),
        this.db.vote.findUnique({
          where: { needId_userId: { needId, userId: viewerId } },
          select: { id: true },
        }),
      ]);
      kycVerified = user?.kycStatus === KycStatus.VERIFIED;
      isBuilder = user?.roles.includes(UserRole.BUILDER) ?? false;
      hasVoted = vote !== null;
    }

    const base = toListItem(need);
    return ok({
      ...base,
      bountyDeadline: need.bountyDeadline?.toISOString() ?? null,
      description: need.description,
      targetAudience: need.targetAudience,
      expectedForm: need.expectedForm,
      attachments: need.attachments,
      createdAt: need.createdAt.toISOString(),
      requesterId: need.requesterId,
      statusLogs: need.statusLogs.map((l) => ({
        id: l.id,
        fromStatus: l.fromStatus,
        toStatus: l.toStatus,
        reason: l.reason,
        createdAt: l.createdAt.toISOString(),
      })),
      viewer: {
        loggedIn: viewerId != null,
        isRequester,
        kycVerified,
        isBuilder,
        hasVoted,
        canVote: viewerId != null && kycVerified && !hasVoted && isVotable(need.status),
      },
    });
  }
}
