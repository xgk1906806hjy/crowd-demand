import { NextRequest } from "next/server";
import { z } from "zod";
import { UserRole } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { RoleService } from "@/domain/role/service";
import { err, DomainError } from "@/domain/shared/result";
import { toResponse } from "@/lib/api-response";

const bodySchema = z.object({
  role: z.nativeEnum(UserRole),
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
    return toResponse(err("角色参数不合法", DomainError.VALIDATION));
  }

  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const service = new RoleService();
  return toResponse(await service.apply(session.userId, parsed.data.role, ip));
}
