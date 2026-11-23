import { cookies } from "next/headers";
import { verifySession, type SessionPayload } from "@/lib/session";

/** 接口层统一读取当前会话。 */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("cd_session")?.value;
  return verifySession(token);
}
