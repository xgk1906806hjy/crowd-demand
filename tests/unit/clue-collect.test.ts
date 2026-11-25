import { describe, it, expect, vi, beforeEach } from "vitest";
import { collectClues, pickRoundQueries } from "@/domain/clue/collect";
import type { ClueItem } from "@/infrastructure/clue/types";

vi.mock("@/domain/shared/audit", () => ({ writeAudit: vi.fn().mockResolvedValue({}) }));

// 采集编排只测节流、来源失败隔离与候选缓冲；入库逻辑由 clue-service.test.ts 覆盖
vi.mock("@/domain/clue/service", () => ({
  ClueService: class {
    async ingest(items: unknown[]) {
      return { ok: true, value: { fetched: items.length, created: items.length, merged: 0, skipped: 0 } };
    }
  },
}));

vi.mock("@/domain/clue/llm-search", () => ({ listActiveQueries: async () => [] }));

const okItems: ClueItem[] = [
  {
    sourceKey: "csdn",
    externalId: "a1",
    title: "有没有推荐的工具",
    excerpt: "求一个能自动整理的工具",
    url: "https://blog.csdn.net/a/1",
    authorId: "u1",
    mentionedAt: new Date(),
  },
  {
    sourceKey: "csdn",
    externalId: "a2",
    title: "求推荐一款软件",
    excerpt: "想找一个能自动排班的软件",
    url: "https://blog.csdn.net/a/2",
    authorId: "u2",
    mentionedAt: new Date(),
  },
];

vi.mock("@/infrastructure/clue/factory", () => ({
  createClueSources: () => [
    { key: "csdn", name: "CSDN", fetch: async () => okItems },
    {
      key: "weixin",
      name: "微信公众号",
      fetch: async () => {
        throw new Error("timeout of 15000ms exceeded");
      },
    },
  ],
}));

function makeDb(lastRunAt?: Date, existing: Array<{ sourceKey: string; externalId: string }> = []) {
  const state = new Map<string, { key: string; lastRunAt: Date }>();
  if (lastRunAt) state.set("clue-ingest", { key: "clue-ingest", lastRunAt });
  return {
    state,
    db: {
      clueMention: {
        async findMany() {
          return existing;
        },
      },
      clueCandidate: {
        async findMany() {
          return existing;
        },
        async createMany({ data }: { data: unknown[]; skipDuplicates?: boolean }) {
          return { count: data.length };
        },
      },
      demandSource: {
        async findMany() {
          return [
            { key: "csdn", enabled: true },
            { key: "weixin", enabled: true },
          ];
        },
        async upsert() {
          return {};
        },
      },
      cronState: {
        async findUnique({ where }: { where: { key: string } }) {
          return state.get(where.key) ?? null;
        },
        async upsert({
          where,
          create,
        }: {
          where: { key: string };
          update: { lastRunAt: Date };
          create: { key: string; lastRunAt: Date };
        }) {
          const row = state.get(where.key) ?? create;
          row.lastRunAt = create.lastRunAt;
          state.set(where.key, row);
          return row;
        },
      },
    },
  };
}

describe("collectClues 采集编排（F29）", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("多来源采集，单来源失败被隔离而不影响整轮", async () => {
    const ctx = makeDb();
    const res = await collectClues({ db: ctx.db as never });
    expect(res.ran).toBe(true);
    expect(res.sources.csdn?.fetched).toBe(2);
    expect(res.sources.weixin?.error).toContain("timeout");
    // v0.8：轮次只写候选缓冲区，入库交给小时聚合
    expect(res.candidates).toBe(2);
    expect(res.ingest).toBeUndefined();
    expect(ctx.state.get("clue-ingest")).toBeDefined();
  });

  it("间隔内重复触发被节流；force 跳过节流", async () => {
    const ctx = makeDb(new Date());
    const throttled = await collectClues({ db: ctx.db as never });
    expect(throttled.ran).toBe(false);
    expect(throttled.reason).toBe("throttled");

    const forced = await collectClues({ force: true, db: ctx.db as never });
    expect(forced.ran).toBe(true);
  });

  it("超过间隔后恢复执行", async () => {
    const ctx = makeDb(new Date(Date.now() - 61 * 60_000));
    const res = await collectClues({ db: ctx.db as never });
    expect(res.ran).toBe(true);
  });
});

describe("检索词轮换（v0.8）", () => {
  it("每轮只取固定条数，并随轮次序号滑动", () => {
    const interval = 10 * 60_000;
    const base = 1_700_000_000_000;
    const a = pickRoundQueries([], new Date(base), interval, 2);
    const b = pickRoundQueries([], new Date(base + interval), interval, 2);
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
    expect(new Set([...a, ...b]).size).toBeGreaterThanOrEqual(3);
  });

  it("模型检索词与固定词合并去重，数量不超过词表", () => {
    const out = pickRoundQueries(["自己做的词", "自己做的词"], new Date(1_700_000_000_000), 600_000, 100);
    expect(out.length).toBeGreaterThan(0);
    expect(out.filter((q) => q === "自己做的词").length).toBeLessThanOrEqual(1);
  });
});
