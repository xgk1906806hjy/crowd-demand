import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { NeedQueryService } from "@/domain/need/query";

export const dynamic = "force-dynamic";

/** GET /api/needs/[id] —— 需求详情（F05）。 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession();
  const service = new NeedQueryService();
  return toResponse(await service.detail(id, session?.userId ?? null));
}
