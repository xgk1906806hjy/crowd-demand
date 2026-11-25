import { NextRequest } from "next/server";
import { UserRole } from "@prisma/client";
import { getSessionUser } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { ClueService } from "@/domain/clue/service";

export const dynamic = "force-dynamic";

/** POST /api/admin/clues/sources —— 启停采集来源（F29）。 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));
  if (!user.roles.includes(UserRole.OPERATOR)) {
    return toResponse(err("仅运营方可管理来源", DomainError.FORBIDDEN));
  }

  let body: { key?: unknown; enabled?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return toResponse(err("请求体格式不正确", DomainError.VALIDATION));
  }
  if (typeof body.key !== "string" || !body.key || typeof body.enabled !== "boolean") {
    return toResponse(err("需提供 key（字符串）与 enabled（布尔）", DomainError.VALIDATION));
  }

  return toResponse(await new ClueService().setSourceEnabled(user.userId, body.key, body.enabled));
}
