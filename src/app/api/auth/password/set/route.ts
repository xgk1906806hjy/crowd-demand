import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { AuthService } from "@/domain/auth/service";
import { createSmsGateway } from "@/infrastructure/sms/gateway";
import { err, DomainError } from "@/domain/shared/result";
import { toResponse } from "@/lib/api-response";

const bodySchema = z.object({
  password: z.string().min(1, "请输入新密码"),
  currentPassword: z.string().optional(),
});

/** POST /api/auth/password/set —— 设置/修改密码（F31，需登录）。 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return toResponse(err("请求体不是合法 JSON", DomainError.VALIDATION));
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return toResponse(err(parsed.error.issues[0]?.message ?? "参数错误", DomainError.VALIDATION));
  }

  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const service = new AuthService(createSmsGateway());
  return toResponse(await service.setPassword(session.userId, { ...parsed.data, ip }));
}
