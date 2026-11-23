/**
 * 统一结果类型 —— 领域层不抛裸异常到接口层，用 Result 表达成功/失败。
 */
export type Ok<T> = { ok: true; value: T };
export type Err<E = string> = { ok: false; error: E; code?: string };
export type Result<T, E = string> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E = string>(error: E, code?: string): Err<E> {
  return { ok: false, error, code };
}

/** 领域错误码，接口层据此映射 HTTP 状态码。 */
export const DomainError = {
  VALIDATION: "VALIDATION",
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
  RATE_LIMITED: "RATE_LIMITED",
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_STATE: "INVALID_STATE",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type DomainErrorCode = (typeof DomainError)[keyof typeof DomainError];
