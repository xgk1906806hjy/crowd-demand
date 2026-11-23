import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { MilestoneService, type PlanItem } from "@/domain/milestone/service";

export const dynamic = "force-dynamic";

/** GET /api/projects/[id]/milestones —— 里程碑总览（F14）。 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getSession();
  return toResponse(await new MilestoneService().getByProject(id, session?.userId ?? null));
}

/** POST /api/projects/[id]/milestones —— 拆分里程碑（F14）。 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));

  const { id } = await ctx.params;

  let body: { items?: unknown };
  try {
    body = (await req.json()) as { items?: unknown };
  } catch {
    return toResponse(err("请求体格式不正确", DomainError.VALIDATION));
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return toResponse(err("请至少添加一个里程碑", DomainError.VALIDATION));
  }

  const items: PlanItem[] = [];
  for (const raw of body.items) {
    const item = raw as Record<string, unknown>;
    if (
      typeof item.title !== "string" ||
      typeof item.deliverable !== "string" ||
      typeof item.releaseRatio !== "number"
    ) {
      return toResponse(err("里程碑字段不完整", DomainError.VALIDATION));
    }
    items.push({
      title: item.title,
      deliverable: item.deliverable,
      releaseRatio: item.releaseRatio,
    });
  }

  return toResponse(await new MilestoneService().plan(session.userId, id, items));
}
