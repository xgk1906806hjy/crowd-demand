import { NextRequest } from "next/server";
import { toResponse } from "@/lib/api-response";
import { ok } from "@/domain/shared/result";
import { ClueService } from "@/domain/clue/service";

export const dynamic = "force-dynamic";

/** GET /api/clues/top —— 公开需求热榜（F29），按提及人数排序。 */
export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "20");
  const items = await new ClueService().top(Number.isFinite(limit) ? limit : 20);
  return toResponse(ok({ items }));
}
