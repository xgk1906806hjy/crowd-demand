import { describe, it, expect, vi } from "vitest";
import { ReportService } from "@/domain/report/service";

vi.mock("@/domain/shared/audit", () => ({ writeAudit: vi.fn().mockResolvedValue({}) }));

function makeDb() {
  const reports: Array<Record<string, any>> = [];
  let seq = 0;

  const db = {
    report: {
      findFirst: async ({ where }: { where: Record<string, any> }) =>
        reports.find(
          (r) =>
            r.reporterId === where.reporterId &&
            r.targetType === where.targetType &&
            r.targetId === where.targetId &&
            r.status === where.status,
        ) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) =>
        reports.find((r) => r.id === where.id) ?? null,
      findMany: async ({ where }: { where?: Record<string, any> } = {}) =>
        reports.filter((r) => !where?.status || r.status === where.status),
      create: async ({ data }: { data: Record<string, any> }) => {
        const r = { id: `r${++seq}`, createdAt: new Date(), handledBy: null, ...data };
        reports.push(r);
        return r;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
        const r = reports.find((x) => x.id === where.id);
        if (!r) throw new Error("report not found");
        Object.assign(r, data);
        return r;
      },
    },
  };

  return { db, reports };
}

const valid = { targetType: "NEED" as const, targetId: "n1", reason: "该需求描述与实际严重不符，疑似虚假宣传" };

describe("ReportService 举报（F20）", () => {
  it("原因过短被拒绝", async () => {
    const { db } = makeDb();
    const res = await new ReportService(db as never).create("u1", { ...valid, reason: "骗人" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("举报对象类型不合法被拒绝", async () => {
    const { db } = makeDb();
    const res = await new ReportService(db as never).create("u1", {
      ...valid,
      targetType: "ORDER" as never,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("VALIDATION");
  });

  it("同一用户重复举报同一对象返回冲突", async () => {
    const { db } = makeDb();
    const service = new ReportService(db as never);
    await service.create("u1", valid);
    const res = await service.create("u1", valid);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("CONFLICT");
  });

  it("举报成功进入待处理", async () => {
    const { db, reports } = makeDb();
    const res = await new ReportService(db as never).create("u1", valid);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.status).toBe("PENDING");
    expect(reports).toHaveLength(1);
  });

  it("处理举报：成立则 RESOLVED，并记录处理人", async () => {
    const { db, reports } = makeDb();
    const service = new ReportService(db as never);
    await service.create("u1", valid);

    const res = await service.handle("op1", reports[0]!.id, "RESOLVE", "已核实");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.status).toBe("RESOLVED");
    expect(reports[0]?.handledBy).toBe("op1");
  });

  it("已处理的举报不能再次处理", async () => {
    const { db, reports } = makeDb();
    const service = new ReportService(db as never);
    await service.create("u1", valid);
    await service.handle("op1", reports[0]!.id, "REJECT");

    const again = await service.handle("op1", reports[0]!.id, "RESOLVE");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe("INVALID_STATE");
  });
});
