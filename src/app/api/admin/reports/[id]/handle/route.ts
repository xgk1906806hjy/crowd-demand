import { NextRequest } from "next/server";
import { UserRole } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { ReportService } from "@/domain/report/service";

export const dynamic = "force-dynamic";

/** POST /api/admin/reports/[id]/handle —— 处理举报（F20）。 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));
  if (!session.roles.includes(UserRole.OPERATOR)) {
    return toResponse(err("仅运营方可处理举报", DomainError.FORBIDDEN));
  }

  const { id } = await ctx.params;

  let body: { action?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return toResponse(err("请求体格式不正确", DomainError.VALIDATION));
  }

  if (body.action !== "RESOLVE" && body.action !== "REJECT") {
    return toResponse(err("action 仅支持 RESOLVE / REJECT", DomainError.VALIDATION));
  }

  return toResponse(
    await new ReportService().handle(
      session.userId,
      id,
      body.action,
      typeof body.note === "string" ? body.note : undefined,
    ),
  );
}
