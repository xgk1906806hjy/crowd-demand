import { KycStatus, NeedMode, NeedStatus, UserRole, type Prisma } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma/client";
import { writeAudit } from "@/domain/shared/audit";
import { ok, err, DomainError, type Result } from "@/domain/shared/result";
import {
  canTransitionForMode,
  NEED_MODE_LABEL,
  NEED_STATUS_LABEL,
} from "@/domain/need/state-machine";
import { failNeedAndRefund } from "@/domain/pledge/lifecycle";
import {
  createPaymentGateway,
  type PaymentGateway,
} from "@/infrastructure/payment/gateway";

/** 需求标题/正文长度约束：太短的描述无法让开发者报价。 */
export const NEED_LIMITS = {
  titleMin: 5,
  titleMax: 60,
  descMin: 30,
  descMax: 5000,
  amountMin: 10_000n, // 100 元
  amountMax: 100_000_000n, // 100 万元
  maxAttachments: 9,
  maxDeadlineDays: 365,
} as const;

export interface CreateNeedInput {
  title: string;
  description: string;
  targetAudience?: string | null;
  expectedForm?: string | null;
  attachments?: string[];
  /** 承诺目标金额（分）。接口层用 yuanToCents 转换，禁止浮点。 */
  targetAmount: bigint;
  /** 承诺截止时间 */
  deadline?: Date | null;
  /** 进入承诺期所需票数，默认 100 */
  voteThreshold?: number;
  /** 需求模式（PRD v0.2）：众筹 / 悬赏 / 无偿认领，默认众筹。 */
  mode?: NeedMode;
  /** 悬赏金额（分），BOUNTY 模式必填。 */
  bountyAmount?: bigint;
  /** 方案征集截止时间，BOUNTY / OPEN 使用。 */
  bountyDeadline?: Date | null;
}

export interface NeedCreatedView {
  id: string;
  status: NeedStatus;
  mode: NeedMode;
  bountyAmount: string;
  publishedAt: Date | null;
}

/** 发起者（非运营）允许自己触发的流转：仅发布与撤销。 */
const REQUESTER_TRANSITIONS: Partial<Record<NeedStatus, NeedStatus[]>> = {
  [NeedStatus.DRAFT]: [NeedStatus.COLLECTING],
  [NeedStatus.COLLECTING]: [NeedStatus.FAILED],
};

function textLength(s: string): number {
  return Array.from(s.trim()).length;
}

export class NeedService {
  constructor(
    private readonly db: typeof prisma = prisma,
    private readonly gateway: PaymentGateway = createPaymentGateway(),
  ) {}

  /** 发布需求（F04）：校验 → 落库 → 记录初始状态日志 → 自动授予需求发起者角色。 */
  async create(
    userId: string,
    input: CreateNeedInput,
    options: { publish?: boolean } = {},
  ): Promise<Result<NeedCreatedView>> {
    const publish = options.publish ?? true;

    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, roles: true, kycStatus: true },
    });
    if (!user) return err("用户不存在", DomainError.NOT_FOUND);

    // F04 依赖 F02：未实名不得发布，防止垃圾需求与虚假承诺
    if (user.kycStatus !== KycStatus.VERIFIED) {
      return err("发布需求前需先完成实名认证", DomainError.FORBIDDEN);
    }

    const title = input.title.trim();
    const description = input.description.trim();
    const mode = input.mode ?? NeedMode.CROWDFUND;

    if (textLength(title) < NEED_LIMITS.titleMin || textLength(title) > NEED_LIMITS.titleMax) {
      return err(
        `标题需为 ${NEED_LIMITS.titleMin}-${NEED_LIMITS.titleMax} 个字符`,
        DomainError.VALIDATION,
      );
    }
    if (textLength(description) < NEED_LIMITS.descMin) {
      return err(
        `痛点描述至少 ${NEED_LIMITS.descMin} 个字符，写清楚现状、场景和期望，开发者才能准确报价`,
        DomainError.VALIDATION,
      );
    }
    if (textLength(description) > NEED_LIMITS.descMax) {
      return err(`痛点描述不得超过 ${NEED_LIMITS.descMax} 个字符`, DomainError.VALIDATION);
    }
    // 众筹才有"承诺目标金额"；悬赏的目标额就是悬赏金，无偿认领没有金额
    if (mode === NeedMode.CROWDFUND) {
      if (input.targetAmount < NEED_LIMITS.amountMin) {
        return err("承诺目标金额不得低于 100 元", DomainError.VALIDATION);
      }
      if (input.targetAmount > NEED_LIMITS.amountMax) {
        return err("承诺目标金额不得超过 1,000,000 元", DomainError.VALIDATION);
      }
    }
    if (mode === NeedMode.BOUNTY) {
      const bounty = input.bountyAmount ?? 0n;
      if (bounty < NEED_LIMITS.amountMin) {
        return err("悬赏金额不得低于 100 元", DomainError.VALIDATION);
      }
      if (bounty > NEED_LIMITS.amountMax) {
        return err("悬赏金额不得超过 1,000,000 元", DomainError.VALIDATION);
      }
    } else if (input.bountyAmount && input.bountyAmount !== 0n) {
      return err("仅悬赏模式可填写悬赏金额", DomainError.VALIDATION);
    }

    const attachments = input.attachments ?? [];
    if (attachments.length > NEED_LIMITS.maxAttachments) {
      return err(`附件最多 ${NEED_LIMITS.maxAttachments} 个`, DomainError.VALIDATION);
    }
    if (attachments.some((a) => typeof a !== "string" || a.length === 0)) {
      return err("附件标识不合法", DomainError.VALIDATION);
    }

    const deadline = input.deadline ?? null;
    if (deadline) {
      if (Number.isNaN(deadline.getTime())) {
        return err("截止时间格式不正确", DomainError.VALIDATION);
      }
      if (deadline.getTime() <= Date.now()) {
        return err("截止时间必须晚于当前时间", DomainError.VALIDATION);
      }
      const maxDeadline = Date.now() + NEED_LIMITS.maxDeadlineDays * 24 * 3600 * 1000;
      if (deadline.getTime() > maxDeadline) {
        return err(`截止时间不得超过 ${NEED_LIMITS.maxDeadlineDays} 天`, DomainError.VALIDATION);
      }
    }

    const threshold = input.voteThreshold ?? 100;
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 10_000) {
      return err("票数门槛需为 1-10000 的整数", DomainError.VALIDATION);
    }

    const now = new Date();
    // 众筹：发布即进征集；悬赏：付费成功后才开放（此处保持草稿）；认领：发布即开放方案征集
    const status = !publish
      ? NeedStatus.DRAFT
      : mode === NeedMode.CROWDFUND
        ? NeedStatus.COLLECTING
        : mode === NeedMode.OPEN
          ? NeedStatus.BIDDING
          : NeedStatus.DRAFT;

    if (
      status !== NeedStatus.DRAFT &&
      !canTransitionForMode(NeedStatus.DRAFT, status, mode)
    ) {
      return err("该模式不支持直接发布，请检查模式参数", DomainError.VALIDATION);
    }

    const bountyAmount = mode === NeedMode.BOUNTY ? (input.bountyAmount ?? 0n) : 0n;
    const targetAmount =
      mode === NeedMode.CROWDFUND
        ? input.targetAmount
        : mode === NeedMode.BOUNTY
          ? bountyAmount
          : 0n;

    const need = await this.db.need.create({
      data: {
        requesterId: userId,
        title,
        description,
        targetAudience: input.targetAudience?.trim() || null,
        expectedForm: input.expectedForm?.trim() || null,
        attachments,
        status,
        mode,
        bountyAmount,
        bountyDeadline: mode === NeedMode.CROWDFUND ? null : (input.bountyDeadline ?? null),
        voteThreshold: threshold,
        targetAmount,
        deadline,
        publishedAt: status === NeedStatus.DRAFT ? null : now,
      },
      select: { id: true, status: true, mode: true, bountyAmount: true, publishedAt: true },
    });

    await this.db.needStatusLog.create({
      data: {
        needId: need.id,
        fromStatus: status === NeedStatus.DRAFT ? null : NeedStatus.DRAFT,
        toStatus: status,
        reason:
          status === NeedStatus.DRAFT
            ? `创建草稿（${NEED_MODE_LABEL[mode]}）`
            : `${NEED_MODE_LABEL[mode]}模式发布`,
        actorId: userId,
      },
    });

    // 发布即成为需求发起者（幂等，不重复写）
    if (!user.roles.includes(UserRole.REQUESTER)) {
      await this.db.user.update({
        where: { id: userId },
        data: { roles: [...user.roles, UserRole.REQUESTER] },
      });
    }

    await writeAudit({
      action: "NEED",
      actorId: userId,
      target: `need:${need.id}`,
      detail: {
        event: status === NeedStatus.DRAFT ? "NEED_DRAFTED" : "NEED_PUBLISHED",
        status,
        mode,
        bountyAmount: bountyAmount.toString(),
      },
    });

    return ok({
      id: need.id,
      status: need.status,
      mode: need.mode,
      bountyAmount: need.bountyAmount.toString(),
      publishedAt: need.publishedAt,
    });
  }

  /** 状态流转（F06）：所有状态变更唯一入口，必须写 NeedStatusLog。 */
  async transition(
    userId: string,
    needId: string,
    to: NeedStatus,
    reason?: string,
  ): Promise<Result<{ id: string; status: NeedStatus }>> {
    const need = await this.db.need.findUnique({
      where: { id: needId },
      select: { id: true, status: true, mode: true, requesterId: true, publishedAt: true },
    });
    if (!need) return err("需求不存在", DomainError.NOT_FOUND);

    const actor = await this.db.user.findUnique({
      where: { id: userId },
      select: { id: true, roles: true },
    });
    if (!actor) return err("用户不存在", DomainError.NOT_FOUND);

    const isOperator = actor.roles.includes(UserRole.OPERATOR);
    if (!isOperator) {
      if (need.requesterId !== userId) {
        return err("无权操作该需求", DomainError.FORBIDDEN);
      }
      const allowed = REQUESTER_TRANSITIONS[need.status] ?? [];
      // 非众筹草稿发布后直接进入方案征集（BIDDING），不走承诺期
      const publishToBidding =
        need.status === NeedStatus.DRAFT &&
        need.mode !== NeedMode.CROWDFUND &&
        to === NeedStatus.BIDDING;
      if (!allowed.includes(to) && !publishToBidding) {
        return err(
          `发起者只能发布需求或撤销征集中的需求（当前：${NEED_STATUS_LABEL[need.status]}）`,
          DomainError.FORBIDDEN,
        );
      }
    }

    if (!canTransitionForMode(need.status, to, need.mode)) {
      return err(
        `不允许从「${NEED_STATUS_LABEL[need.status]}」流转到「${NEED_STATUS_LABEL[to]}」`,
        DomainError.INVALID_STATE,
      );
    }

    // 悬赏公开征集前必须已全额托管，否则会出现"未付款却开放方案征集"
    if (
      need.mode === NeedMode.BOUNTY &&
      need.status === NeedStatus.DRAFT &&
      to === NeedStatus.BIDDING
    ) {
      const escrow = await this.db.bountyEscrow.findUnique({
        where: { needId },
        select: { status: true },
      });
      if (!escrow || escrow.status !== "HELD") {
        return err(
          "悬赏需求需先支付悬赏金并完成托管，才能公开征集方案",
          DomainError.INVALID_STATE,
        );
      }
    }

    // 流拍必须带走退款：避免「状态置为已流拍、托管资金却留在账上」
    if (to === NeedStatus.FAILED) {
      const res = await failNeedAndRefund(needId, {
        db: this.db,
        gateway: this.gateway,
        actorId: userId,
        reason: reason?.trim() || "运营方终止需求",
      });
      if (!res.ok) return err(res.error, res.code);

      await writeAudit({
        action: "NEED",
        actorId: userId,
        target: `need:${needId}`,
        detail: {
          event: "NEED_FAILED",
          from: need.status,
          status: res.value.status,
          refundedPledges: res.value.refunded.count,
          refundedAmount: res.value.refunded.total.toString(),
        },
      });

      return ok({ id: needId, status: res.value.status });
    }

    const data: Prisma.NeedUpdateInput = { status: to };
    if (to === NeedStatus.COLLECTING && !need.publishedAt) {
      data.publishedAt = new Date();
    }

    await this.db.$transaction([
      this.db.need.update({ where: { id: needId }, data }),
      this.db.needStatusLog.create({
        data: {
          needId,
          fromStatus: need.status,
          toStatus: to,
          reason: reason?.trim() || null,
          actorId: userId,
        },
      }),
    ]);

    await writeAudit({
      action: "NEED",
      actorId: userId,
      target: `need:${needId}`,
      detail: { event: "NEED_TRANSITION", from: need.status, to },
    });

    return ok({ id: needId, status: to });
  }

  /** 我的需求（控制台），可按状态过滤。 */
  async listMine(
    userId: string,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<Result<{ items: Array<Record<string, unknown>>; total: number }>> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));

    const where = { requesterId: userId };
    const [rows, total] = await Promise.all([
      this.db.need.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          title: true,
          status: true,
          mode: true,
          bountyAmount: true,
          voteCount: true,
          voteThreshold: true,
          targetAmount: true,
          pledgedAmount: true,
          publishedAt: true,
          createdAt: true,
        },
      }),
      this.db.need.count({ where }),
    ]);

    return ok({
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        statusLabel: NEED_STATUS_LABEL[r.status],
        mode: r.mode,
        modeLabel: NEED_MODE_LABEL[r.mode],
        bountyAmount: r.bountyAmount.toString(),
        voteCount: r.voteCount,
        voteThreshold: r.voteThreshold,
        targetAmount: r.targetAmount.toString(),
        pledgedAmount: r.pledgedAmount.toString(),
        publishedAt: r.publishedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
    });
  }
}
