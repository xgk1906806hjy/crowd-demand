import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { yuanToCents } from "@/lib/money";
import { ProposalService } from "@/domain/proposal/service";

export const dynamic = "force-dynamic";

/** GET /api/needs/[id]/proposals —— 提案列表（F12/F13）。 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return toResponse(await new ProposalService().listByNeed(id));
}

/** POST /api/needs/[id]/proposals —— 提交提案（F12）。 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));

  const { id } = await ctx.params;

  let body: {
    understanding?: unknown;
    spec?: unknown;
    quoteYuan?: unknown;
    durationDays?: unknown;
    pastCases?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return toResponse(err("请求体格式不正确", DomainError.VALIDATION));
  }

  if (typeof body.understanding !== "string" || typeof body.spec !== "string") {
    return toResponse(err("需求理解与可执行规格不能为空", DomainError.VALIDATION));
  }
  if (typeof body.quoteYuan !== "string" && typeof body.quoteYuan !== "number") {
    return toResponse(err("请填写报价", DomainError.VALIDATION));
  }

  let quote: bigint;
  try {
    quote = yuanToCents(body.quoteYuan as string | number);
  } catch {
    return toResponse(err("报价格式不正确，最多两位小数", DomainError.VALIDATION));
  }

  const durationDays = Number(body.durationDays);

  const result = await new ProposalService().submit(session.userId, id, {
    understanding: body.understanding,
    spec: body.spec,
    quote,
    durationDays,
    pastCases: typeof body.pastCases === "string" ? body.pastCases : null,
  });

  return toResponse(result);
}
