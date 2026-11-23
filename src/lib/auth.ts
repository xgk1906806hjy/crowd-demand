import { cookies } from "next/headers";
import type { KycStatus, UserRole } from "@prisma/client";
import { verifySession, type SessionPayload } from "@/lib/session";
import { prisma } from "@/infrastructure/prisma/client";

/** 接口层统一读取当前会话。 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("cd_session")?.value;
  return verifySession(token);
}

export interface SessionUser {
  userId: string;
  phone: string | null;
  roles: UserRole[];
  kycStatus: KycStatus;
}

/**
 * 读取当前登录用户的**最新**身份信息。
 *
 * JWT 里的 roles 是登录那一刻的快照；角色申请、运营授权之后必须回源数据库，
 * 否则要等用户重新登录才生效。所有按角色判权的接口都应使用本方法。
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, phone: true, roles: true, kycStatus: true },
  });
  if (!user) return null;

  return {
    userId: user.id,
    phone: user.phone,
    roles: user.roles,
    kycStatus: user.kycStatus,
  };
}

/** 是否具备运营权限（以数据库最新角色为准）。 */
export async function isOperator(): Promise<boolean> {
  const user = await getSessionUser();
  return user?.roles.includes("OPERATOR") ?? false;
}
