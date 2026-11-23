import { prisma } from "@/infrastructure/prisma/client";
import { writeAudit } from "@/domain/shared/audit";
import { ok, err, DomainError, type Result } from "@/domain/shared/result";

export const REPORT_TARGETS = ["NEED", "PROPOSAL", "USER"] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export interface CreateReportInput {
  targetType: ReportTarget;
  targetId: string;
  reason: string;
}

export interface ReportView {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  reporterId: string;
  createdAt: string;
  handledBy: string | null;
}

function len(s: string): number {
  return Array.from(s.trim()).length;
}

/** 举报与处理（F20）。 */
export class ReportService {
  constructor(private readonly db: typeof prisma = prisma) {}

  async create(reporterId: string, input: CreateReportInput): Promise<Result<{ id: string; status: string }>> {
    if (!REPORT_TARGETS.includes(input.targetType)) {
      return err("举报对象类型不合法", DomainError.VALIDATION);
    }
    if (!input.targetId || typeof input.targetId !== "string") {
      return err("缺少举报对象", DomainError.VALIDATION);
    }
    const reason = input.reason.trim();
    if (len(reason) < 10) {
      return err("请至少用 10 个字说明举报原因", DomainError.VALIDATION);
    }
    if (len(reason) > 1000) {
      return err("举报原因不得超过 1000 字", DomainError.VALIDATION);
    }

    const duplicate = await this.db.report.findFirst({
      where: {
        reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        status: "PENDING",
      },
      select: { id: true },
    });
    if (duplicate) {
      return err("你已举报过该对象，正在处理中", DomainError.CONFLICT);
    }

    const report = await this.db.report.create({
      data: {
        reporterId,
        targetType: input.targetType,
        targetId: input.targetId,
        reason,
        status: "PENDING",
      },
      select: { id: true, status: true },
    });

    await writeAudit({
      action: "ADMIN",
      actorId: reporterId,
      target: `${input.targetType.toLowerCase()}:${input.targetId}`,
      detail: { event: "REPORT_CREATED", reportId: report.id },
    });

    return ok(report);
  }

  async listPending(limit = 50): Promise<ReportView[]> {
    const rows = await this.db.report.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: Math.min(100, Math.max(1, limit)),
      select: {
        id: true,
        targetType: true,
        targetId: true,
        reason: true,
        status: true,
        reporterId: true,
        createdAt: true,
        handledBy: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      reason: r.reason,
      status: r.status,
      reporterId: r.reporterId,
      createdAt: r.createdAt.toISOString(),
      handledBy: r.handledBy,
    }));
  }

  /** 处理举报：RESOLVE（成立）/ REJECT（不成立）。 */
  async handle(
    operatorId: string,
    reportId: string,
    action: "RESOLVE" | "REJECT",
    note?: string,
  ): Promise<Result<{ status: string }>> {
    const report = await this.db.report.findUnique({
      where: { id: reportId },
      select: { id: true, status: true },
    });
    if (!report) return err("举报不存在", DomainError.NOT_FOUND);
    if (report.status !== "PENDING") {
      return err("该举报已处理", DomainError.INVALID_STATE);
    }

    const status = action === "RESOLVE" ? "RESOLVED" : "REJECTED";
    await this.db.report.update({
      where: { id: reportId },
      data: { status, handledBy: operatorId },
    });

    await writeAudit({
      action: "ADMIN",
      actorId: operatorId,
      target: `report:${reportId}`,
      detail: { event: "REPORT_HANDLED", action, note: note ?? null },
    });

    return ok({ status });
  }
}
