import { describe, it, expect, beforeEach } from "vitest";
import { ReputationService } from "@/domain/reputation/service";

type MemProject = { builderId: string; status: string };

function makeMemoryDb(projects: MemProject[]) {
  const db = {
    project: {
      count: async ({ where }: any) => {
        const builderId = where.proposal?.builderId;
        let rows = projects.filter((p) => p.builderId === builderId);
        if (where.status) rows = rows.filter((p) => p.status === where.status);
        return rows.length;
      },
    },
    user: {
      update: async () => ({}),
    },
  };
  return db as any;
}

describe("ReputationService", () => {
  it("无项目时为基础分 60", async () => {
    const service = new ReputationService(makeMemoryDb([]));
    const view = await service.compute("b1");
    expect(view.score).toBe(60);
    expect(view.totalProjects).toBe(0);
    expect(view.refundRate).toBe(0);
  });

  it("完成项目加分：1 个完成 = 68", async () => {
    const service = new ReputationService(makeMemoryDb([{ builderId: "b1", status: "COMPLETED" }]));
    const view = await service.compute("b1");
    expect(view.score).toBe(68);
    expect(view.completedProjects).toBe(1);
  });

  it("退款项目扣分：2 完成 + 1 退款 = 66", async () => {
    const service = new ReputationService(
      makeMemoryDb([
        { builderId: "b1", status: "COMPLETED" },
        { builderId: "b1", status: "COMPLETED" },
        { builderId: "b1", status: "REFUNDED" },
      ]),
    );
    const view = await service.compute("b1");
    expect(view.score).toBe(66);
    expect(view.refundedProjects).toBe(1);
    expect(view.refundRate).toBeCloseTo(1 / 3);
  });

  it("分数上限收敛到 100", async () => {
    const projects = Array.from({ length: 20 }, () => ({ builderId: "b1", status: "COMPLETED" }));
    const service = new ReputationService(makeMemoryDb(projects));
    expect((await service.compute("b1")).score).toBe(100);
  });

  it("分数下限收敛到 0", async () => {
    const projects = Array.from({ length: 10 }, () => ({ builderId: "b1", status: "REFUNDED" }));
    const service = new ReputationService(makeMemoryDb(projects));
    expect((await service.compute("b1")).score).toBe(0);
  });

  it("只统计当前开发者的项目", async () => {
    const service = new ReputationService(
      makeMemoryDb([
        { builderId: "b1", status: "COMPLETED" },
        { builderId: "b2", status: "COMPLETED" },
        { builderId: "b2", status: "REFUNDED" },
      ]),
    );
    const view = await service.compute("b1");
    expect(view.totalProjects).toBe(1);
    expect(view.completedProjects).toBe(1);
  });
});
