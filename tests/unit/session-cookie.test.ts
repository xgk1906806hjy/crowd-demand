import { describe, it, expect } from "vitest";
import { cookieSecureFor, sessionCookie, type CookieSecureMode } from "@/lib/session";

/** 构造只认识 x-forwarded-proto 的 headers 桩。 */
function headers(proto?: string | null) {
  return {
    get: (name: string) => (name.toLowerCase() === "x-forwarded-proto" ? (proto ?? null) : null),
  };
}

describe("会话 Cookie 的 Secure 决策（明文 HTTP 登录修复）", () => {
  it("auto + 明文 http：不加 Secure（否则浏览器丢弃 Cookie，表现为登录不上）", () => {
    expect(cookieSecureFor(headers("http"), "http://192.168.100.91:8000/api", "auto")).toBe(false);
  });

  it("auto + https：加 Secure", () => {
    expect(cookieSecureFor(headers("https"), "https://example.com/api", "auto")).toBe(true);
  });

  it("auto 处理多级代理串与大小写", () => {
    expect(cookieSecureFor(headers("HTTPS, http"), undefined, "auto")).toBe(true);
    expect(cookieSecureFor(headers(" http "), undefined, "auto")).toBe(false);
  });

  it("auto 缺协议头时回退到请求 URL 协议", () => {
    expect(cookieSecureFor(headers(), "http://example.com/", "auto")).toBe(false);
    expect(cookieSecureFor(headers(), "https://example.com/", "auto")).toBe(true);
    // 相对/空 URL 按不安全处理
    expect(cookieSecureFor(headers(), "/login", "auto")).toBe(false);
  });

  it("显式 true / false 覆盖自动判断", () => {
    const modeTrue: CookieSecureMode = "true";
    const modeFalse: CookieSecureMode = "false";
    expect(cookieSecureFor(headers("http"), "http://x/", modeTrue)).toBe(true);
    expect(cookieSecureFor(headers("https"), "https://x/", modeFalse)).toBe(false);
  });

  it("Cookie 属性：Secure 开关正确，且始终 HttpOnly + Lax + Path=/", () => {
    expect(sessionCookie.options(false)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: false,
    });
    expect(sessionCookie.options(true).secure).toBe(true);
  });
});
