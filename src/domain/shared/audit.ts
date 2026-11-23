import { prisma } from "@/infrastructure/prisma/client";
import type { AuditAction } from "@prisma/client";

/**
 * 审计日志 —— 所有资金与关键操作都写审计，不可物理删除。
 * 合规红线见 AGENTS.md 第 3 节。
 */
export async function writeAudit(params: {
  action: AuditAction;
  actorId?: string;
  target?: string;
  detail?: Record<string, unknown>;
  ip?: string;
}) {
  return prisma.auditLog.create({
    data: {
      action: params.action,
      actorId: params.actorId,
      target: params.target,
      detail: (params.detail ?? {}) as object,
      ip: params.ip,
    },
  });
}
