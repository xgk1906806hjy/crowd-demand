import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/session";

/** 受保护路由：未登录跳转登录页。 */
const PROTECTED_PREFIXES = ["/console", "/admin"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!needsAuth) return NextResponse.next();

  const token = req.cookies.get("cd_session")?.value;
  const session = await verifySession(token);
  if (!session) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/console/:path*", "/admin/:path*"],
};
