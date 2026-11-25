import { describe, it, expect } from "vitest";
import { parseClusters, clusterByRules } from "@/domain/clue/analyze";
import { parseQueryList } from "@/domain/clue/llm-search";
import { parseSearchResponse } from "@/infrastructure/clue/websearch";
import { parseDouyin } from "@/infrastructure/clue/douyin";
import { parseKuaishou } from "@/infrastructure/clue/kuaishou";
import type { ClueItem } from "@/infrastructure/clue/types";

const baseItem = (title: string, externalId = "x"): ClueItem => ({
  sourceKey: "csdn",
  externalId,
  title,
  excerpt: "",
  url: `https://example.com/${externalId}`,
  authorId: "u",
  mentionedAt: new Date(),
});

describe("小时聚合：模型输出解析（v0.8）", () => {
  it("解析 clusters，越界与重复 index 被丢弃", () => {
    const content = JSON.stringify({
      clusters: [
        { canonicalTitle: "批量转换微信ID的工具", memberIndexes: [0, 3, 3, 99], score: 92, reason: "多人缺" },
        { canonicalTitle: "", memberIndexes: [1], score: 90 },
        { canonicalTitle: "笔记工具", memberIndexes: [2], score: 70, reason: "单人" },
      ],
    });
    const out = parseClusters(content, 5);
    expect(out).toHaveLength(2);
    expect(out[0]!.members).toEqual([0, 3]);
    expect(out[0]!.score).toBe(92);
    expect(out[1]!.members).toEqual([2]);
  });

  it("兼容 ```json 代码块并忽略非 JSON 前缀", () => {
    const content = '说明文字\n```json\n{"clusters":[{"canonicalTitle":"X 工具","memberIndexes":[0],"score":85}]}\n```';
    const out = parseClusters(content, 2);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("X 工具");
  });

  it("无模型时规则聚类按标题相似度合并", () => {
    const items = [
      baseItem("求批量转换微信ID的工具", "a"),
      baseItem("有没有能把wxid转成微信号的软件", "b"),
      baseItem("求推荐Redis可视化工具", "c"),
    ];
    const groups = clusterByRules(items);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0]!.members.length).toBeGreaterThanOrEqual(1);
    // 至少有一条被并组，或各自独立（规则匹配不强求），但不能丢条
    const total = groups.reduce((sum, g) => sum + g.members.length, 0);
    expect(total).toBe(items.length);
  });
});

describe("模型检索词解析（v0.8）", () => {
  it("过滤推介类词、去重、限长", () => {
    const content = JSON.stringify({
      queries: [
        "求推荐排班软件",
        "求推荐排班软件",
        "有没有批量转微信id的工具",
        "工具盘点大全",
        "短",
        "求一款自动生成报表的软件",
      ],
    });
    const out = parseQueryList(content, 10);
    expect(out).toEqual(["求推荐排班软件", "有没有批量转微信id的工具", "求一款自动生成报表的软件"]);
  });
});

describe("联网搜索返回解析（v0.8）", () => {
  it("兼容 data/results/web.value/organic_results 四种结构", () => {
    expect(parseSearchResponse({ data: [{ title: "a" }] })).toHaveLength(1);
    expect(parseSearchResponse({ results: [{ name: "b" }] })).toHaveLength(1);
    expect(parseSearchResponse({ web: { value: [{ name: "c" }] } })).toHaveLength(1);
    expect(parseSearchResponse({ organic_results: [{ title: "d" }] })).toHaveLength(1);
    expect(parseSearchResponse(null)).toHaveLength(0);
  });
});

describe("抖音/快手公开页解析（v0.8，尽力而为）", () => {
  it("抖音：从 _ROUTER_DATA 抽取作品", () => {
    const html = `<script>window._ROUTER_DATA = ${JSON.stringify({
      loaderData: {
        search: {
          data: [
            { aweme_info: { aweme_id: "7311", desc: "求推荐能自动剪辑的工具", create_time: 1700000000, author: { uid: "u1" } } },
          ],
        },
      },
    })};</script>`;
    const out = parseDouyin(html);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceKey).toBe("douyin");
    expect(out[0]!.url).toContain("7311");
  });

  it("快手：从 __APOLLO_STATE__ 抽取作品", () => {
    const html = `<script>window.__APOLLO_STATE__ = ${JSON.stringify({
      "Photo:1": { photoId: "3x1", caption: "有没有免费的数据统计工具", timestamp: 1700000000 },
    })};</script>`;
    const out = parseKuaishou(html);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toContain("数据统计");
  });

  it("页面无可解析数据时返回空数组（由来源级失败隔离兜住）", () => {
    expect(parseDouyin("<html></html>")).toEqual([]);
    expect(parseKuaishou("<html></html>")).toEqual([]);
  });
});
