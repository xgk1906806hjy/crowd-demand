import { describe, it, expect } from "vitest";
import { parseIdNumber } from "@/lib/id-number";

// 合法样例：110101 19900307 001 1（校验码已按 GB 11643 计算）
const VALID = "110101199003070011";

describe("身份证号校验", () => {
  it("合法身份证号通过并解析出生日期/性别", () => {
    const res = parseIdNumber(VALID);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.info.regionCode).toBe("110101");
      expect(res.info.gender).toBe("M");
      expect(res.info.birthDate.toISOString().startsWith("1990-03-07")).toBe(true);
    }
  });

  it("支持末位小写 x（校验码为 X 的号码）", () => {
    expect(parseIdNumber("11010119800101007X").ok).toBe(true);
    expect(parseIdNumber("11010119800101007x").ok).toBe(true);
  });

  it("位数/字符不合法被拒绝", () => {
    expect(parseIdNumber("1234").ok).toBe(false);
    expect(parseIdNumber("11010119900307001A").ok).toBe(false);
    expect(parseIdNumber("").ok).toBe(false);
  });

  it("校验码错误被拒绝", () => {
    expect(parseIdNumber("110101199003070012").ok).toBe(false);
  });

  it("非法出生日期被拒绝（2 月 30 日）", () => {
    expect(parseIdNumber("110101199002300011").ok).toBe(false);
  });

  it("未来出生日期被拒绝", () => {
    expect(parseIdNumber("110101299001010011").ok).toBe(false);
  });
});
