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
  options: (isProd = false) => ({
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  }),
};
