import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, ok, DomainError } from "@/domain/shared/result";
import { yuanToCents } from "@/lib/money";
import { NeedService } from "@/domain/need/service";
import { NeedQueryService } from "@/domain/need/query";
import { BountyService } from "@/domain/bounty/service";

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
  mode?: unknown;
  bountyAmountYuan?: unknown;
  bountyDays?: unknown;
}

const MODES = ["CROWDFUND", "BOUNTY", "OPEN"] as const;
type ModeLiteral = (typeof MODES)[number];

function parseMode(v: unknown): ModeLiteral | null {
  if (v === undefined || v === null || v === "") return "CROWDFUND";
  return MODES.includes(v as ModeLiteral) ? (v as ModeLiteral) : null;
}

/** POST /api/needs —— 发布需求（F04 / F28）。 */
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

  const mode = parseMode(body.mode);
  if (!mode) return toResponse(err("需求模式不合法", DomainError.VALIDATION));

  // 众筹必须填承诺目标额；悬赏必须填悬赏金；认领不需要金额
  let targetAmount = 0n;
  if (mode === "CROWDFUND") {
    if (typeof body.targetAmountYuan !== "string" && typeof body.targetAmountYuan !== "number") {
      return toResponse(err("请填写承诺目标金额", DomainError.VALIDATION));
    }
    try {
      targetAmount = yuanToCents(body.targetAmountYuan as string | number);
    } catch {
      return toResponse(err("金额格式不正确，最多两位小数", DomainError.VALIDATION));
    }
  }

  let bountyAmount = 0n;
  if (mode === "BOUNTY") {
    if (typeof body.bountyAmountYuan !== "string" && typeof body.bountyAmountYuan !== "number") {
      return toResponse(err("请填写悬赏金额", DomainError.VALIDATION));
    }
    try {
      bountyAmount = yuanToCents(body.bountyAmountYuan as string | number);
    } catch {
      return toResponse(err("悬赏金额格式不正确，最多两位小数", DomainError.VALIDATION));
    }
  }

  let deadline: Date | null = null;
  if (typeof body.deadline === "string" && body.deadline.trim()) {
    deadline = new Date(body.deadline);
    if (Number.isNaN(deadline.getTime())) {
      return toResponse(err("截止时间格式不正确", DomainError.VALIDATION));
    }
  }

  let bountyDeadline: Date | null = null;
  if (mode !== "CROWDFUND" && body.bountyDays !== undefined && body.bountyDays !== null) {
    const days = Number(body.bountyDays);
    if (!Number.isInteger(days) || days < 1 || days > 60) {
      return toResponse(err("方案征集期需为 1-60 天", DomainError.VALIDATION));
    }
    bountyDeadline = new Date(Date.now() + days * 24 * 3600 * 1000);
  }

  let voteThreshold: number | undefined;
  if (body.voteThreshold !== undefined && body.voteThreshold !== null && body.voteThreshold !== "") {
    voteThreshold = Number(body.voteThreshold);
  }

  const attachments = Array.isArray(body.attachments)
    ? body.attachments.filter((a): a is string => typeof a === "string")
    : [];

  const publish = body.publish !== false;
  const service = new NeedService();
  const created = await service.create(
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
      mode,
      bountyAmount,
      bountyDeadline,
    },
    { publish },
  );
  if (!created.ok) return toResponse(created);

  // 悬赏必须预付全款才公开：这里串起"建草稿 → 托管 → 开放方案征集"
  if (mode === "BOUNTY" && publish) {
    const deposit = await new BountyService().deposit(session.userId, created.value.id);
    if (!deposit.ok) {
      return toResponse(
        err(
          `需求草稿已创建，但悬赏支付未完成：${deposit.error}。可稍后在「我的需求」中重试支付`,
          deposit.code,
        ),
      );
    }
    return toResponse(
      ok({
        id: created.value.id,
        status: deposit.value.status,
        mode,
        bountyAmount: deposit.value.bountyAmount,
        paymentRef: deposit.value.paymentRef,
        publishedAt: created.value.publishedAt?.toISOString() ?? null,
      }),
    );
  }

  return toResponse(
    ok({
      ...created.value,
      publishedAt: created.value.publishedAt?.toISOString() ?? null,
    }),
  );
}
