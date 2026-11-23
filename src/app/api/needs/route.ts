import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, DomainError } from "@/domain/shared/result";
import { yuanToCents } from "@/lib/money";
import { NeedService } from "@/domain/need/service";
import { NeedQueryService } from "@/domain/need/query";

export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string | undefined {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
}

/** GET /api/needs —— 需求列表与榜单（F05/F08）。 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const session = await getSession();

  if (sp.get("scope") === "mine") {
    if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));
    const service = new NeedService();
    const result = await service.listMine(session.userId, {
      page: Number(sp.get("page") ?? 1),
      pageSize: Number(sp.get("pageSize") ?? 20),
    });
    return toResponse(result);
  }

  const service = new NeedQueryService();
  const result = await service.list({
    sort: sp.get("sort"),
    status: sp.get("status"),
    keyword: sp.get("keyword"),
    page: Number(sp.get("page") ?? 1),
    pageSize: Number(sp.get("pageSize") ?? 12),
  });
  return toResponse(result);
}

interface CreateNeedBody {
  title?: unknown;
  description?: unknown;
  targetAudience?: unknown;
  expectedForm?: unknown;
  attachments?: unknown;
  targetAmountYuan?: unknown;
  deadline?: unknown;
  voteThreshold?: unknown;
  publish?: unknown;
}

/** POST /api/needs —— 发布需求（F04）。 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));

  let body: CreateNeedBody;
  try {
    body = (await req.json()) as CreateNeedBody;
  } catch {
    return toResponse(err("请求体格式不正确", DomainError.VALIDATION));
  }

  if (typeof body.title !== "string" || typeof body.description !== "string") {
    return toResponse(err("标题与痛点描述不能为空", DomainError.VALIDATION));
  }
  if (typeof body.targetAmountYuan !== "string" && typeof body.targetAmountYuan !== "number") {
    return toResponse(err("请填写承诺目标金额", DomainError.VALIDATION));
  }

  let targetAmount: bigint;
  try {
    targetAmount = yuanToCents(body.targetAmountYuan as string | number);
  } catch {
    return toResponse(err("金额格式不正确，最多两位小数", DomainError.VALIDATION));
  }

  let deadline: Date | null = null;
  if (typeof body.deadline === "string" && body.deadline.trim()) {
    deadline = new Date(body.deadline);
    if (Number.isNaN(deadline.getTime())) {
      return toResponse(err("截止时间格式不正确", DomainError.VALIDATION));
    }
  }

  let voteThreshold: number | undefined;
  if (body.voteThreshold !== undefined && body.voteThreshold !== null && body.voteThreshold !== "") {
    voteThreshold = Number(body.voteThreshold);
  }

  const attachments = Array.isArray(body.attachments)
    ? body.attachments.filter((a): a is string => typeof a === "string")
    : [];

  const service = new NeedService();
  const result = await service.create(
    session.userId,
    {
      title: body.title,
      description: body.description,
      targetAudience: typeof body.targetAudience === "string" ? body.targetAudience : null,
      expectedForm: typeof body.expectedForm === "string" ? body.expectedForm : null,
      attachments,
      targetAmount,
      deadline,
      voteThreshold,
    },
    { publish: body.publish !== false },
  );

  return toResponse(result);
}
