import { SignJWT, jwtVerify } from "jose";
import type { UserRole } from "@prisma/client";
import { env } from "@/lib/env";

const SESSION_COOKIE = "cd_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 天（秒）

export interface SessionPayload {
  userId: string;
  roles: UserRole[];
  phone: string | null;
}

const secretKey = new TextEncoder().encode(env.AUTH_SECRET);

/** 签发 JWT。 */
export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    roles: payload.roles,
    phone: payload.phone,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey);
}

/** 校验 JWT，失败返回 null。 */
export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return {
      userId: payload.sub,
      roles: (Array.isArray(payload.roles) ? payload.roles : []) as UserRole[],
      phone: typeof payload.phone === "string" ? payload.phone : null,
    };
  } catch {
    return null;
  }
}

export const sessionCookie = {
  name: SESSION_COOKIE,
  maxAge: SESSION_MAX_AGE,
  options: (secure = false) => ({
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  }),
};

export type CookieSecureMode = "auto" | "true" | "false";

/**
 * 计算会话 Cookie 的 Secure 属性。
 * - auto：按 X-Forwarded-Proto（nginx 透传）判断，https 才加 Secure；缺头时看请求 URL 协议。
 * - 原因：浏览器会拒绝在明文 HTTP 站点保存 Secure Cookie，导致"登录成功但会话不落地"。
 */
export function cookieSecureFor(
  headers: { get(name: string): string | null },
  url?: string | URL,
  mode: CookieSecureMode = env.SESSION_COOKIE_SECURE,
): boolean {
  if (mode === "true") return true;
  if (mode === "false") return false;
  const forwarded = headers.get("x-forwarded-proto");
  if (forwarded) {
    return forwarded.split(",")[0]!.trim().toLowerCase() === "https";
  }
  if (url) {
    const href = typeof url === "string" ? url : url.href;
    return href.startsWith("https:");
  }
  return false;
}
