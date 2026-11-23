import { NeedStatus, type Prisma } from "@prisma/client";
import { canTransition, NEED_STATUS_LABEL } from "@/domain/need/state-machine";

/**
 * 需求状态流转的事务内唯一入口（F06）。
 *
 * 约定：
 * - 只能按 `NEED_TRANSITIONS` 允许的边流转，非法流转直接抛错（调用方应先做业务校验）。
 * - 用 `updateMany + 状态条件` 做乐观并发控制：并发下只有一方能成功，返回 false 的一方
 *   需要自行降级处理（例如把 funded 置回 false）。
 * - 流转成功必须写 `NeedStatusLog`，与状态变更在同一事务内提交。
 *
 * 领域服务内部任何改需求状态的动作都必须走这里，禁止散落的 `need.update({ status })`。
 */
export type NeedTx = Pick<Prisma.TransactionClient, "need" | "needStatusLog">;

export interface NeedTransitionInput {
  needId: string;
  from: NeedStatus;
  to: NeedStatus;
  reason?: string | null;
  actorId?: string | null;
  /** 与流转同事务更新的附加字段，例如发布时补 publishedAt。 */
  extra?: Prisma.NeedUpdateManyMutationInput;
}

export async function transitionNeedInTx(
  tx: NeedTx,
  input: NeedTransitionInput,
): Promise<boolean> {
  if (!canTransition(input.from, input.to)) {
    throw new Error(
      `非法流转：${NEED_STATUS_LABEL[input.from]} → ${NEED_STATUS_LABEL[input.to]}`,
    );
  }

  const moved = await tx.need.updateMany({
    where: { id: input.needId, status: input.from },
    data: { status: input.to, ...input.extra },
  });
  if (moved.count !== 1) return false;

  await tx.needStatusLog.create({
    data: {
      needId: input.needId,
      fromStatus: input.from,
      toStatus: input.to,
      reason: input.reason?.trim() || null,
      actorId: input.actorId ?? null,
    },
  });

  return true;
}
