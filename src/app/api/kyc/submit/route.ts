import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { KycService } from "@/domain/kyc/service";
import { createKycGateway } from "@/infrastructure/kyc/gateway";
import { err, DomainError } from "@/domain/shared/result";
import { toResponse } from "@/lib/api-response";

const bodySchema = z.object({
  realName: z.string().min(1, "请填写姓名"),
  idNumber: z.string().min(1, "请填写身份证号"),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return toResponse(err("未登录", DomainError.UNAUTHORIZED));

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
  const service = new KycService(createKycGateway());
  return toResponse(
    await service.submit(session.userId, {
      realName: parsed.data.realName,
      idNumber: parsed.data.idNumber,
      ip,
    }),
  );
}
