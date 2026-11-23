import { NextResponse } from "next/server";
import type { Result } from "@/domain/shared/result";
import { DomainError } from "@/domain/shared/result";

const statusByCode: Record<string, number> = {
  [DomainError.VALIDATION]: 400,
  [DomainError.NOT_FOUND]: 404,
  [DomainError.FORBIDDEN]: 403,
  [DomainError.CONFLICT]: 409,
  [DomainError.RATE_LIMITED]: 429,
  [DomainError.UNAUTHORIZED]: 401,
  [DomainError.INVALID_STATE]: 409,
  [DomainError.SERVICE_UNAVAILABLE]: 503,
};

/** 将领域层 Result 映射为 HTTP 响应。bigint 会被序列化为字符串。 */
export function toResponse<T>(result: Result<T>): NextResponse {
  if (result.ok) {
    return NextResponse.json({ data: result.value }, { status: 200 });
  }
  const status = result.code ? (statusByCode[result.code] ?? 400) : 400;
  return NextResponse.json(
    { error: result.error, code: result.code ?? DomainError.VALIDATION },
    { status },
  );
}

/** bigint 安全序列化（JSON.stringify 默认不支持 bigint）。 */
export function jsonBigInt(key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
