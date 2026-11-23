import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 合规闸门测试：确保「生产环境禁用 Mock 适配器」不因重构而被绕过。
 * env 模块在导入时解析 process.env，因此每次用例都要重置模块缓存后动态导入。
 */
async function loadEnvModule(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  const prevAppEnv = process.env.APP_ENV;
  if (overrides.APP_ENV === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = overrides.APP_ENV;

  const mod = await import("@/lib/env");

  // 还原，避免污染其它用例
  if (prevAppEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = prevAppEnv;

  return mod;
}

describe("合规闸门 assertMockAdapterAllowed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("开发/测试环境放行 Mock 适配器", async () => {
    const { assertMockAdapterAllowed } = await loadEnvModule();
    expect(() => assertMockAdapterAllowed("短信", "development")).not.toThrow();
    expect(() => assertMockAdapterAllowed("支付", "test")).not.toThrow();
  });

  it("生产环境未声明 demo 时抛错", async () => {
    const { assertMockAdapterAllowed } = await loadEnvModule();
    expect(() => assertMockAdapterAllowed("短信", "production")).toThrow(/合规红线/);
    expect(() => assertMockAdapterAllowed("支付", "production")).toThrow(/合规红线/);
  });

  it("生产环境显式 APP_ENV=demo 时放行，但必须告警", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { assertMockAdapterAllowed } = await loadEnvModule({ APP_ENV: "demo" });

    expect(() => assertMockAdapterAllowed("短信", "production")).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/APP_ENV=demo/);

    // 同类适配器不重复刷屏
    assertMockAdapterAllowed("短信", "production");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("支付合规校验复用同一闸门", async () => {
    const { assertProductionPaymentSafe } = await loadEnvModule();
    // 测试环境（vitest env 未设 PAYMENT_ADAPTER，默认 mock）
    expect(() => assertProductionPaymentSafe("production")).toThrow(/合规红线/);
    expect(() => assertProductionPaymentSafe("development")).not.toThrow();
  });
});
