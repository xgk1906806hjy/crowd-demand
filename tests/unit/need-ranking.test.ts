import { describe, it, expect } from "vitest";
import {
  buildNeedOrderBy,
  computeProgress,
  normalizeSort,
  NEED_SORTS,
} from "@/domain/need/query";

describe("榜单排序（F08）", () => {
  it("未知排序回退为热度榜", () => {
    expect(normalizeSort(null)).toBe("hot");
    expect(normalizeSort("xxx")).toBe("hot");
    expect(normalizeSort("pledge")).toBe("pledge");
  });

  it("热度榜按票数降序", () => {
    const order = buildNeedOrderBy("hot");
    expect(order[0]).toEqual({ voteCount: "desc" });
  });

  it("承诺榜按承诺金额降序", () => {
    const order = buildNeedOrderBy("pledge");
    expect(order[0]).toEqual({ pledgedAmount: "desc" });
  });

  it("最新榜按发布时间降序", () => {
    const order = buildNeedOrderBy("latest");
    expect(order[0]).toEqual({ publishedAt: "desc" });
  });

  it("即将截止按截止时间升序", () => {
    const order = buildNeedOrderBy("deadline");
    expect(order[0]).toEqual({ deadline: "asc" });
  });

  it("每种排序都带稳定的次级排序", () => {
    for (const sort of NEED_SORTS) {
      expect(buildNeedOrderBy(sort).length).toBeGreaterThan(1);
    }
  });

  it("进度百分比计算", () => {
    expect(computeProgress(0n, 10_000n)).toBe(0);
    expect(computeProgress(5_000n, 10_000n)).toBe(50);
    expect(computeProgress(2_500n, 10_000n)).toBe(25);
    expect(computeProgress(1_000n, 3_000n)).toBe(33.3);
  });

  it("目标金额为 0 时不除零", () => {
    expect(computeProgress(1_000n, 0n)).toBe(0);
  });

  it("超额完成保留百分比但不超过上限", () => {
    expect(computeProgress(20_000n, 10_000n)).toBe(200);
  });
});
