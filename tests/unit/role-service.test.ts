import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserRole } from "@prisma/client";
import { RoleService } from "@/domain/role/service";

vi.mock("@/domain/shared/audit", () => ({ writeAudit: vi.fn().mockResolvedValue({}) }));

type MemUser = { id: string; roles: string[]; kycStatus: string };

function makeMemoryDb() {
  const users = new Map<string, MemUser>();
  const db = {
    user: {
      findUnique: async ({ where }: any) => users.get(where.id) ?? null,
      update: async ({ where, data }: any) => {
        const u = users.get(where.id);
        if (!u) throw new Error("user not found");
        Object.assign(u, data);
        return { roles: u.roles };
      },
    },
  };
  return { db: db as any, users };
}

describe("RoleService", () => {
  let mem: ReturnType<typeof makeMemoryDb>;
  let service: RoleService;

  beforeEach(() => {
    mem = makeMemoryDb();
    mem.users.set("u1", { id: "u1", roles: ["BACKER"], kycStatus: "NONE" });
    mem.users.set("u2", { id: "u2", roles: ["BACKER"], kycStatus: "VERIFIED" });
    service = new RoleService(mem.db);
  });

  it("申请需求发起者成功", async () => {
    const res = await service.apply("u1", UserRole.REQUESTER);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.roles).toContain("REQUESTER");
    expect(mem.users.get("u1")!.roles).toEqual(["BACKER", "REQUESTER"]);
  });

  it("重复申请幂等，不重复添加", async () => {
    await service.apply("u1", UserRole.REQUESTER);
    const res = await service.apply("u1", UserRole.REQUESTER);
    expect(res.ok).toBe(true);
    expect(mem.users.get("u1")!.roles).toEqual(["BACKER", "REQUESTER"]);
  });

  it("未实名申请开发者被拒绝", async () => {
    const res = await service.apply("u1", UserRole.BUILDER);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("FORBIDDEN");
    expect(mem.users.get("u1")!.roles).not.toContain("BUILDER");
  });

  it("已实名可申请开发者", async () => {
    const res = await service.apply("u2", UserRole.BUILDER);
    expect(res.ok).toBe(true);
    expect(mem.users.get("u2")!.roles).toContain("BUILDER");
  });

  it("运营方角色不可自助申请", async () => {
    const res = await service.apply("u2", UserRole.OPERATOR);
    expect(res.ok).toBe(false);
  });
});
