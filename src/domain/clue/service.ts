import { ClueStatus } from "@prisma/client";
import { prisma } from "@/infrastructure/prisma/client";
import { writeAudit } from "@/domain/shared/audit";
import { ok, err, DomainError, type Result } from "@/domain/shared/result";
import type { ClueItem } from "@/infrastructure/clue/types";
import {
  authorPseudonym,
  extractKeywords,
  isSamePain,
  looksLikeDemand,
  sanitizeExcerpt,
} from "./keywords";

const SOURCE_NAMES: Record<string, string> = {
  csdn: "CSDN",
  weixin: "微信公众号",
  juejin: "掘金",
  v2ex: "V2EX",
  hn: "Hacker News",
  reddit: "Reddit 许愿板",
};

export interface IngestSummary {
  fetched: number;
  created: number;
  merged: number;
  skipped: number;
}

export interface ClueSourceView {
  key: string;
  name: string;
  enabled: boolean;
}

export interface ClueView {
  id: string;
  title: string;
  summary: string;
  status: ClueStatus;
  mentionCount: number;
  mentionerCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  /** 最近提及的来源样本（≤3 个渠道，含原文链接） */
  sources: Array<{ sourceKey: string; name: string; url: string }>;
}

/**
 * 需求线索服务（F29）。
 * - 入库幂等：`(sourceKey, externalId)` 唯一约束，重复采集不重复计数；
 * - 聚合同一痛点：关键词相似度合并，提及人数按作者哈希去重；
 * - 隐私：只存脱敏公开摘要与来源链接，作者不可逆伪名化。
 */
export class ClueService {
  constructor(private readonly db: typeof prisma = prisma) {}

  /**
   * 批量入库外部提及。逐条隔离处理，单条失败不影响其余。
   * requireDemandSignal：是否再做一次本地规则判定。启用大模型时由模型统一判定，
   * 这里必须传 false——模型给出的规范化标题往往已去掉「求推荐/有没有」等字眼，再判会误杀。
   */
  async ingest(
    items: ClueItem[],
    opts: { requireDemandSignal?: boolean } = {},
  ): Promise<Result<IngestSummary>> {
    const summary: IngestSummary = { fetched: items.length, created: 0, merged: 0, skipped: 0 };
    const requireDemandSignal = opts.requireDemandSignal ?? true;

    for (const key of new Set(items.map((i) => i.sourceKey))) {
      await this.db.demandSource.upsert({
        where: { key },
        update: {},
        create: { key, name: SOURCE_NAMES[key] ?? key },
      });
    }
    const sources = await this.db.demandSource.findMany();
    const enabled = new Set(sources.filter((s) => s.enabled).map((s) => s.key));

    for (const item of items) {
      const title = (item.title ?? "").trim().slice(0, 120);
      if (!item.externalId || !title || !enabled.has(item.sourceKey)) {
        summary.skipped++;
        continue;
      }
      const excerpt = sanitizeExcerpt(item.excerpt ?? "");
      if (requireDemandSignal && !looksLikeDemand(`${title} ${excerpt}`)) {
        summary.skipped++;
        continue;
      }

      const dup = await this.db.clueMention.findUnique({
        where: {
          sourceKey_externalId: { sourceKey: item.sourceKey, externalId: item.externalId },
        },
        select: { id: true },
      });
      if (dup) {
        summary.skipped++;
        continue;
      }

      const keywords = extractKeywords(title);
      const candidates = await this.db.demandClue.findMany({
        where: { status: { not: ClueStatus.DISCARDED } },
        select: { id: true, title: true, keywords: true, lastSeenAt: true },
        orderBy: { lastSeenAt: "desc" },
        take: 300,
      });
      const match = candidates.find((c) => isSamePain({ title, keywords }, c));
      const authorKey = authorPseudonym(item.sourceKey, item.authorId || item.externalId);
      const mentionedAt =
        item.mentionedAt instanceof Date && !Number.isNaN(item.mentionedAt.getTime())
          ? item.mentionedAt
          : new Date();

      try {
        await this.db.$transaction(async (tx) => {
          let clueId: string;
          if (match) {
            clueId = match.id;
            await tx.clueMention.create({
              data: {
                clueId,
                sourceKey: item.sourceKey,
                externalId: item.externalId,
                authorKey,
                url: item.url,
                excerpt,
                mentionedAt,
              },
            });
            await tx.demandClue.update({
              where: { id: clueId },
              data: {
                mentionCount: { increment: 1 },
                ...(mentionedAt > match.lastSeenAt ? { lastSeenAt: mentionedAt } : {}),
              },
            });
          } else {
            const clue = await tx.demandClue.create({
              data: {
                title,
                summary: excerpt || title,
                keywords,
                mentionCount: 1,
                firstSeenAt: mentionedAt,
                lastSeenAt: mentionedAt,
              },
            });
            clueId = clue.id;
            await tx.clueMention.create({
              data: {
                clueId,
                sourceKey: item.sourceKey,
                externalId: item.externalId,
                authorKey,
                url: item.url,
                excerpt,
                mentionedAt,
              },
            });
          }
          const groups = await tx.clueMention.groupBy({
            by: ["authorKey"],
            where: { clueId },
            _count: { _all: true },
          });
          await tx.demandClue.update({
            where: { id: clueId },
            data: { mentionerCount: groups.length },
          });
        });
        if (match) summary.merged++;
        else summary.created++;
      } catch (e) {
        // 并发重复入库：唯一约束兜底，按跳过计
        if ((e as { code?: string }).code === "P2002") summary.skipped++;
        else throw e;
      }
    }

    if (summary.created + summary.merged > 0) {
      await writeAudit({
        action: "ADMIN",
        target: "clue-ingest",
        detail: { ...summary },
      });
    }
    return ok(summary);
  }

  /** 公开需求热榜：按提及人数 > 提及次数 > 最近提及时间排序。 */
  async top(limit = 20): Promise<ClueView[]> {
    const clues = await this.db.demandClue.findMany({
      where: { status: { not: ClueStatus.DISCARDED } },
      orderBy: [{ mentionerCount: "desc" }, { mentionCount: "desc" }, { lastSeenAt: "desc" }],
      take: Math.min(Math.max(limit, 1), 50),
      include: { mentions: { orderBy: { mentionedAt: "desc" }, take: 6 } },
    });
    const sourceRows = await this.db.demandSource.findMany();
    const names = new Map(sourceRows.map((s) => [s.key, s.name]));

    return clues.map((c) => {
      const seen = new Set<string>();
      const samples: ClueView["sources"] = [];
      for (const m of c.mentions) {
        if (seen.has(m.sourceKey)) continue;
        seen.add(m.sourceKey);
        samples.push({
          sourceKey: m.sourceKey,
          name: names.get(m.sourceKey) ?? m.sourceKey,
          url: m.url,
        });
        if (samples.length >= 3) break;
      }
      return {
        id: c.id,
        title: c.title,
        summary: c.summary,
        status: c.status,
        mentionCount: c.mentionCount,
        mentionerCount: c.mentionerCount,
        firstSeenAt: c.firstSeenAt.toISOString(),
        lastSeenAt: c.lastSeenAt.toISOString(),
        sources: samples,
      };
    });
  }

  /** 运营列表：全部线索（含已丢弃），最近提及优先。 */
  async listForAdmin(): Promise<ClueView[]> {
    const clues = await this.db.demandClue.findMany({
      orderBy: { lastSeenAt: "desc" },
      take: 200,
      include: { mentions: { orderBy: { mentionedAt: "desc" }, take: 6 } },
    });
    const sourceRows = await this.db.demandSource.findMany();
    const names = new Map(sourceRows.map((s) => [s.key, s.name]));
    return clues.map((c) => {
      const seen = new Set<string>();
      const samples: ClueView["sources"] = [];
      for (const m of c.mentions) {
        if (seen.has(m.sourceKey)) continue;
        seen.add(m.sourceKey);
        samples.push({
          sourceKey: m.sourceKey,
          name: names.get(m.sourceKey) ?? m.sourceKey,
          url: m.url,
        });
        if (samples.length >= 3) break;
      }
      return {
        id: c.id,
        title: c.title,
        summary: c.summary,
        status: c.status,
        mentionCount: c.mentionCount,
        mentionerCount: c.mentionerCount,
        firstSeenAt: c.firstSeenAt.toISOString(),
        lastSeenAt: c.lastSeenAt.toISOString(),
        sources: samples,
      };
    });
  }

  async listSources(): Promise<ClueSourceView[]> {
    const rows = await this.db.demandSource.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map((s) => ({ key: s.key, name: s.name, enabled: s.enabled }));
  }

  /** 运营审核：收录（FEATURED）或丢弃（DISCARDED，热榜隐藏且不再合并新提及）。 */
  async review(
    operatorId: string,
    clueId: string,
    action: "FEATURE" | "DISCARD",
  ): Promise<Result<{ id: string; status: ClueStatus }>> {
    const clue = await this.db.demandClue.findUnique({
      where: { id: clueId },
      select: { id: true, status: true },
    });
    if (!clue) return err("线索不存在", DomainError.NOT_FOUND);
    if (clue.status === ClueStatus.DISCARDED) {
      return err("该线索已丢弃，不可再操作", DomainError.INVALID_STATE);
    }
    const status = action === "FEATURE" ? ClueStatus.FEATURED : ClueStatus.DISCARDED;
    await this.db.demandClue.update({
      where: { id: clueId },
      data: { status, reviewedBy: operatorId, reviewedAt: new Date() },
    });
    await writeAudit({
      action: "ADMIN",
      actorId: operatorId,
      target: `clue:${clueId}`,
      detail: { action },
    });
    return ok({ id: clueId, status });
  }

  /** 启停采集来源。 */
  async setSourceEnabled(
    operatorId: string,
    key: string,
    enabled: boolean,
  ): Promise<Result<ClueSourceView>> {
    const source = await this.db.demandSource.findUnique({ where: { key } });
    if (!source) return err("来源不存在", DomainError.NOT_FOUND);
    const updated = await this.db.demandSource.update({
      where: { key },
      data: { enabled },
    });
    await writeAudit({
      action: "ADMIN",
      actorId: operatorId,
      target: `clue-source:${key}`,
      detail: { enabled },
    });
    return ok({ key: updated.key, name: updated.name, enabled: updated.enabled });
  }
}
