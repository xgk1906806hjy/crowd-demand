import { describe, it, expect } from "vitest";
import { generateCode, hashCode, safeHashEqual } from "@/domain/auth/code";

describe("验证码工具", () => {
  it("生成 6 位数字验证码", () => {
    const code = generateCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it("相同输入产生相同哈希，不同目标产生不同哈希", () => {
    expect(hashCode("123456", "13800138000")).toBe(hashCode("123456", "13800138000"));
    expect(hashCode("123456", "13800138000")).not.toBe(hashCode("123456", "13900139000"));
  });

  it("恒定时间比较正确/错误哈希", () => {
    const h = hashCode("123456", "13800138000");
    expect(safeHashEqual(h, h)).toBe(true);
    expect(safeHashEqual(h, hashCode("654321", "13800138000"))).toBe(false);
  });
});
