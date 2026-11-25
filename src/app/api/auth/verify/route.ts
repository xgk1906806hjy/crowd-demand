import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthService } from "@/domain/auth/service";
import { createSmsGateway } from "@/infrastructure/sms/gateway";
import { err, DomainError } from "@/domain/shared/result";
import { toResponse } from "@/lib/api-response";
import { sessionCookie, cookieSecureFor } from "@/lib/session";

const bodySchema = z
  .object({
    phone: z.string().optional(),
    email: z.string().optional(),
    code: z.string().regex(/^\d{6}$/, "验证码为 6 位数字"),
  })
  .refine((v) => Boolean(v.phone?.trim()) !== Boolean(v.email?.trim()), {
    message: "请提供手机号或邮箱其中之一",
  });

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
  const result = await service.verifyCode({ ...parsed.data, ip });
  if (!result.ok) return toResponse(result);

  const response = NextResponse.json({ data: result.value }, { status: 200 });
  response.cookies.set(
    sessionCookie.name,
    result.value.token,
    sessionCookie.options(cookieSecureFor(req.headers, req.url)),
  );
  return response;
}
