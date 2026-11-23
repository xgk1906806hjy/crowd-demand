import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { yuanToCents } from "@/lib/money";
import { PledgeService } from "@/domain/pledge/service";

export const dynamic = "force-dynamic";

/** GET /api/needs/[id]/pledges —— 公开承诺列表（F09）。 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 20);
  const service = new PledgeService();
  return toResponse(await service.listByNeed(id, Number.isFinite(limit) ? limit : 20));
}

/** POST /api/needs/[id]/pledges —— 付费承诺（F09）。 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));

  const { id } = await ctx.params;

  let body: { amountYuan?: unknown; idempotencyKey?: unknown };
  try {
    body = (await req.json()) as { amountYuan?: unknown; idempotencyKey?: unknown };
  } catch {
    return toResponse(err("请求体格式不正确", DomainError.VALIDATION));
  }

  if (typeof body.amountYuan !== "string" && typeof body.amountYuan !== "number") {
    return toResponse(err("请填写承诺金额", DomainError.VALIDATION));
  }

  let amount: bigint;
  try {
    amount = yuanToCents(body.amountYuan as string | number);
  } catch {
    return toResponse(err("金额格式不正确，最多两位小数", DomainError.VALIDATION));
  }

  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : undefined;

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  const service = new PledgeService();
  return toResponse(await service.pledge(session.userId, id, { amount, idempotencyKey }, ip));
}
