import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { VoteService } from "@/domain/vote/service";

export const dynamic = "force-dynamic";

/** POST /api/needs/[id]/vote —— 投票 / 取消投票（F07）。 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));

  const { id } = await ctx.params;

  let action: unknown = "UP";
  try {
    const body = (await req.json()) as { action?: unknown };
    action = body.action ?? "UP";
  } catch {
    // 无请求体按投票处理
  }

  if (action !== "UP" && action !== "CANCEL") {
    return toResponse(err("action 仅支持 UP / CANCEL", DomainError.VALIDATION));
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  const service = new VoteService();
  const result =
    action === "UP"
      ? await service.cast(session.userId, id, ip)
      : await service.cancel(session.userId, id, ip);

  return toResponse(result);
}
