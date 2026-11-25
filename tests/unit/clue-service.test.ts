import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClueStatus } from "@prisma/client";
import { ClueService } from "@/domain/clue/service";
import type { ClueItem } from "@/infrastructure/clue/types";

vi.mock("@/domain/shared/audit", () => ({ writeAudit: vi.fn().mockResolvedValue({}) }));

type MemClue = {
  id: string;
  title: string;
  summary: string;
  keywords: string[];
  status: ClueStatus;
  mentionCount: number;
  mentionerCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
};

type MemMention = {
  id: string;
  clueId: string;
  sourceKey: string;
  externalId: string;
  authorKey: string;
  url: string;
  excerpt: string;
  mentionedAt: Date;
};

function makeDb() {
  const clues = new Map<string, MemClue>();
  const mentions: MemMention[] = [];
  const sources = new Map<string, { key: string; name: string; enabled: boolean; createdAt: Date }>();
  let seq = 0;
  const nid = (p: string) => `${p}${++seq}`;

  const db = {
    demandSource: {
      async upsert({ where, create }: { where: { key: string }; update: object; create: { key: string; name: string } }) {
        const existing = sources.get(where.key);
        if (existing) return existing;
        const row = { ...create, enabled: true, createdAt: new Date() };
        sources.set(where.key, row);
        return row;
      },
      async findMany() {
        return Array.from(sources.values()).sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );
      },
      async findUnique({ where }: { where: { key: string } }) {
        return sources.get(where.key) ?? null;
      },
      async update({ where, data }: { where: { key: string }; data: { enabled: boolean } }) {
        const row = sources.get(where.key);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      },
    },
    demandClue: {
      async findMany(args?: {
        where?: { status?: { not?: ClueStatus } };
        orderBy?: unknown;
        take?: number;
        include?: { mentions?: { orderBy?: unknown; take?: number } };
        select?: object;
      }) {
        let rows = Array.from(clues.values());
        const not = args?.where?.status?.not;
        if (not) rows = rows.filter((c) => c.status !== not);
        // 排序：与 service 的两种 orderBy 对齐
        const ob = JSON.stringify(args?.orderBy ?? "");
        if (ob.includes("mentionerCount")) {
          rows.sort(
            (a, b) =>
              b.mentionerCount - a.mentionerCount ||
              b.mentionCount - a.mentionCount ||
              b.lastSeenAt.getTime() - a.lastSeenAt.getTime(),
          );
        } else {
          rows.sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
        }
        if (args?.take) rows = rows.slice(0, args.take);
        return rows.map((c) => ({
          ...c,
          keywords: [...c.keywords],
          mentions: mentions
            .filter((m) => m.clueId === c.id)
            .sort((a, b) => b.mentionedAt.getTime() - a.mentionedAt.getTime())
            .slice(0, args?.include?.mentions?.take ?? 99),
        }));
      },
      async findUnique({ where }: { where: { id: string } }) {
        const c = clues.get(where.id);
        return c ? { ...c } : null;
      },
      async create({ data }: { data: Omit<MemClue, "id" | "status" | "mentionerCount" | "reviewedBy" | "reviewedAt"> }) {
        const row: MemClue = {
          id: nid("c"),
          status: ClueStatus.COLLECTED,
          mentionerCount: 0,
          reviewedBy: null,
          reviewedAt: null,
          ...data,
        };
        clues.set(row.id, row);
        return { ...row };
      },
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: Omit<Partial<MemClue>, "mentionCount"> & {
          mentionCount?: number | { increment: number };
        };
      }) {
        const row = clues.get(where.id);
        if (!row) throw new Error("not found");
        const { mentionCount, ...rest } = data;
        if (mentionCount && typeof mentionCount === "object" && "increment" in mentionCount) {
          row.mentionCount += mentionCount.increment;
        } else if (typeof mentionCount === "number") {
          row.mentionCount = mentionCount;
        }
        Object.assign(row, rest);
        return { ...row };
      },
    },
    clueMention: {
      async findUnique({ where }: { where: { sourceKey_externalId: { sourceKey: string; externalId: string } } }) {
        const k = where.sourceKey_externalId;
        return mentions.find((m) => m.sourceKey === k.sourceKey && m.externalId === k.externalId) ?? null;
      },
      async create({ data }: { data: Omit<MemMention, "id"> }) {
        if (mentions.some((m) => m.sourceKey === data.sourceKey && m.externalId === data.externalId)) {
          const e = new Error("unique") as Error & { code: string };
          e.code = "P2002";
          throw e;
        }
        const row = { id: nid("m"), ...data };
        mentions.push(row);
        return row;
      },
      async groupBy({ where }: { by: string[]; where: { clueId: string }; _count: object }) {
        const keys = new Set(mentions.filter((m) => m.clueId === where.clueId).map((m) => m.authorKey));
        return Array.from(keys).map((authorKey) => ({ authorKey, _count: { _all: 1 } }));
      },
    },
  };

  const withTx = {
    ...db,
    async $transaction<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
      return fn(db);
    },
  };

  return { db: withTx, clues, mentions, sources };
}

function item(over: Partial<ClueItem> & { externalId: string }): ClueItem {
  return {
    sourceKey: "mock",
    title: "有没有能把微信群里的会议通知自动整理成日程的工具",
    excerpt: "有没有能自动识别群聊会议通知并生成日程提醒的工具？",
    url: `https://example.com/${over.externalId}`,
    authorId: `author-${over.externalId}`,
    mentionedAt: new Date("2026-11-24T08:00:00Z"),
    ...over,
  };
}

describe("ClueService 采集入库与聚合（F29）", () => {
  let ctx: ReturnType<typeof makeDb>;
  let service: ClueService;

  beforeEach(() => {
    ctx = makeDb();
    service = new ClueService(ctx.db as never);
  });

  it("同一痛点的多条提及合并为一条线索并计数", async () => {
    const res = await service.ingest([
      item({ externalId: "a" }),
      item({ externalId: "b", title: "想要一个把群聊里的会议通知整理成日程提醒的小工具" }),
      item({ externalId: "c", title: "求推荐：群聊会议通知自动转日历日程的软件" }),
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.created).toBe(1);
      expect(res.value.merged).toBe(2);
    }
    expect(ctx.clues.size).toBe(1);
    const clue = Array.from(ctx.clues.values())[0];
    expect(clue?.mentionCount).toBe(3);
    expect(clue?.mentionerCount).toBe(3);
  });

  it("重复采集幂等：同一 (sourceKey, externalId) 不重复计数", async () => {
    const items = [item({ externalId: "a" }), item({ externalId: "b" })];
    await service.ingest(items);
    const res = await service.ingest(items);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.created).toBe(0);
      expect(res.value.merged).toBe(0);
      expect(res.value.skipped).toBe(2);
    }
    const clue = Array.from(ctx.clues.values())[0];
    expect(clue?.mentionCount).toBe(2);
  });

  it("同一作者多条提及：次数累加但人数只算 1", async () => {
    await service.ingest([
      item({ externalId: "a", authorId: "same-user" }),
      item({ externalId: "b", authorId: "same-user", title: "求推荐：群聊会议通知自动转日历日程的软件" }),
    ]);
    const clue = Array.from(ctx.clues.values())[0];
    expect(clue?.mentionCount).toBe(2);
    expect(clue?.mentionerCount).toBe(1);
  });

  it("非需求表达被过滤，不入库", async () => {
    const res = await service.ingest([
      item({ externalId: "news", title: "今天发布了 3.0 新版本", excerpt: "性能提升明显" }),
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.skipped).toBe(1);
    expect(ctx.clues.size).toBe(0);
  });

  it("停用的来源不入库", async () => {
    await service.ingest([item({ externalId: "a" })]); // 先建来源
    ctx.sources.get("mock")!.enabled = false;
    const res = await service.ingest([item({ externalId: "b" })]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.skipped).toBe(1);
    expect(ctx.mentions).toHaveLength(1);
  });

  it("入库摘要已脱敏，作者只存哈希", async () => {
    await service.ingest([
      item({ externalId: "a", excerpt: "有没有整理会议通知的工具？联系 13812345678", authorId: "real-name-user" }),
    ]);
    const m = ctx.mentions[0];
    expect(m?.excerpt).not.toContain("13812345678");
    expect(m?.authorKey).not.toContain("real-name-user");
    expect(m?.authorKey).toHaveLength(64);
  });

  it("热榜按提及人数 > 提及次数排序，丢弃的不上榜", async () => {
    await service.ingest([
      item({ externalId: "a" }),
      item({ externalId: "b", title: "想要一个把群聊里的会议通知整理成日程提醒的小工具" }),
      item({
        externalId: "inv1",
        title: "求一个能把发票截图自动整理成报销表格的工具",
        excerpt: "求一个能把发票截图自动整理成报销表格的工具",
      }),
    ]);
    const top = await service.top();
    expect(top[0]?.title).toContain("会议通知");
    expect(top[0]?.mentionerCount).toBe(2);
    expect(top[1]?.title).toContain("发票");

    const invoiceId = top[1]?.id as string;
    await service.review("op1", invoiceId, "DISCARD");
    const after = await service.top();
    expect(after.find((c) => c.id === invoiceId)).toBeUndefined();
  });

  it("丢弃的线索不再合并新提及，新提及另立线索", async () => {
    await service.ingest([item({ externalId: "a" })]);
    const clueId = Array.from(ctx.clues.keys())[0] as string;
    await service.review("op1", clueId, "DISCARD");
    await service.ingest([item({ externalId: "b" })]);
    expect(ctx.clues.size).toBe(2);
  });

  it("审核：收录置 FEATURED；已丢弃不可再操作", async () => {
    await service.ingest([item({ externalId: "a" })]);
    const clueId = Array.from(ctx.clues.keys())[0] as string;
    const okRes = await service.review("op1", clueId, "FEATURE");
    expect(okRes.ok).toBe(true);
    if (okRes.ok) expect(okRes.value.status).toBe(ClueStatus.FEATURED);

    await service.review("op1", clueId, "DISCARD");
    const bad = await service.review("op1", clueId, "FEATURE");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("INVALID_STATE");
  });

  it("启停来源：不存在的 key 返回 NOT_FOUND", async () => {
    const res = await service.setSourceEnabled("op1", "nope", false);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("NOT_FOUND");

    await service.ingest([item({ externalId: "a" })]);
    const okRes = await service.setSourceEnabled("op1", "mock", false);
    expect(okRes.ok).toBe(true);
    if (okRes.ok) expect(okRes.value.enabled).toBe(false);
  });
});
