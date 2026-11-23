import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { ReportService, REPORT_TARGETS, type ReportTarget } from "@/domain/report/service";

export const dynamic = "force-dynamic";

/** POST /api/reports —— 提交举报（F20）。 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));

  let body: { targetType?: unknown; targetId?: unknown; reason?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return toResponse(err("请求体格式不正确", DomainError.VALIDATION));
  }

  const targetType = typeof body.targetType === "string" ? body.targetType.toUpperCase() : "";
  if (!(REPORT_TARGETS as readonly string[]).includes(targetType)) {
    return toResponse(err("举报对象类型不合法", DomainError.VALIDATION));
  }
  if (typeof body.targetId !== "string" || typeof body.reason !== "string") {
    return toResponse(err("举报对象与原因不能为空", DomainError.VALIDATION));
  }

  return toResponse(
    await new ReportService().create(session.userId, {
      targetType: targetType as ReportTarget,
      targetId: body.targetId,
      reason: body.reason,
    }),
  );
}
