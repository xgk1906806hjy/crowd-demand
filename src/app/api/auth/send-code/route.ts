import { NextRequest } from "next/server";
import { z } from "zod";
import { AuthService } from "@/domain/auth/service";
import { createSmsGateway } from "@/infrastructure/sms/gateway";
import { err, DomainError } from "@/domain/shared/result";
import { toResponse } from "@/lib/api-response";

const bodySchema = z.object({ phone: z.string().regex(/^1[3-9]\d{9}$/, "手机号格式不正确") });

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
  return toResponse(await service.requestCode({ phone: parsed.data.phone, ip }));
}
