import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthService } from "@/domain/auth/service";
import { createSmsGateway } from "@/infrastructure/sms/gateway";
import { err, DomainError } from "@/domain/shared/result";
import { toResponse } from "@/lib/api-response";
import { sessionCookie, cookieSecureFor } from "@/lib/session";

const bodySchema = z.object({
  username: z.string().min(1, "请输入用户名"),
  password: z.string().min(1, "请输入密码"),
});

/** POST /api/auth/register —— 用户名密码注册（F32），成功即签发会话。 */
export async function POST(req: NextRequest) {
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
  const result = await service.register({ ...parsed.data, ip });
  if (!result.ok) return toResponse(result);

  const response = NextResponse.json({ data: result.value }, { status: 201 });
  response.cookies.set(
    sessionCookie.name,
    result.value.token,
    sessionCookie.options(cookieSecureFor(req.headers, req.url)),
  );
  return response;
}
