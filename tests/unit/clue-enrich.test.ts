import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ClueItem } from "@/infrastructure/clue/types";

const llmEnv = vi.hoisted(() => ({
  LLM_BASE_URL: undefined as string | undefined,
  LLM_API_KEY: undefined as string | undefined,
  LLM_MODEL: undefined as string | undefined,
  LLM_WIRE_API: "chat" as "chat" | "responses",
  LLM_FALLBACK_BASE_URL: undefined as string | undefined,
  LLM_FALLBACK_API_KEY: undefined as string | undefined,
  LLM_FALLBACK_MODEL: undefined as string | undefined,
  LLM_FALLBACK_WIRE_API: "chat" as "chat" | "responses",
}));

vi.mock("@/lib/env", () => ({ env: llmEnv }));

import { isClueLlmEnabled, refineClues } from "@/domain/clue/enrich";

const items: ClueItem[] = [
  {
    sourceKey: "csdn",
    externalId: "1",
    title: "求推荐一款自动排班软件",
    excerpt: "小店排班太麻烦，求一个能自动排班并通知员工的工具",
    url: "https://blog.csdn.net/a/1",
    authorId: "u1",
    mentionedAt: new Date(),
  },
  {
    sourceKey: "weixin",
    externalId: "2",
    title: "2025 AI 工具年度盘点",
    excerpt: "盘点今年最受欢迎的 AI 产品",
    url: "https://weixin.sogou.com/link?x",
    authorId: "gzh",
    mentionedAt: new Date(),
  },
];

describe("refineClues 大模型整合（F29 v0.4）", () => {
  beforeEach(() => {
    llmEnv.LLM_BASE_URL = undefined;
    llmEnv.LLM_API_KEY = undefined;
    llmEnv.LLM_MODEL = undefined;
    llmEnv.LLM_WIRE_API = "chat";
    llmEnv.LLM_FALLBACK_BASE_URL = undefined;
    llmEnv.LLM_FALLBACK_API_KEY = undefined;
    llmEnv.LLM_FALLBACK_MODEL = undefined;
    llmEnv.LLM_FALLBACK_WIRE_API = "chat";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("未配置 LLM_* 时不调用模型，原样返回", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await refineClues(items);
    expect(isClueLlmEnabled()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res).toMatchObject({ applied: false, dropped: 0 });
    expect(res.items).toHaveLength(2);
  });

  it("配置后按模型判定剔除伪需求并替换规范化标题", async () => {
    llmEnv.LLM_BASE_URL = "https://api.example.com/v1";
    llmEnv.LLM_API_KEY = "test-key";
    llmEnv.LLM_MODEL = "test-model";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      index: 0,
                      isDemand: true,
                      score: 90,
                      reason: "缺自动排班并通知员工的工具",
                      title: "自动排班并通知员工的小店排班工具",
                    },
                    { index: 1, isDemand: false },
                  ],
                }),
              },
            },
          ],
        }),
      }),
    );

    const res = await refineClues(items);
    expect(res.applied).toBe(true);
    expect(res.dropped).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.title).toBe("自动排班并通知员工的小店排班工具");
    // 原始元数据保持不变
    expect(res.items[0]!.url).toBe("https://blog.csdn.net/a/1");
  });

  it("模型接口失败时降级为规则判定：只保留有需求句式、非推介标题的条目", async () => {
    llmEnv.LLM_BASE_URL = "https://api.example.com/v1";
    llmEnv.LLM_API_KEY = "test-key";
    llmEnv.LLM_MODEL = "test-model";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));

    const res = await refineClues(items);
    expect(res.applied).toBe(false);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.title).toBe("求推荐一款自动排班软件");
    expect(res.dropped).toBeGreaterThan(0);
  });

  it("发往模型的载荷不含作者与链接（隐私）", async () => {
    llmEnv.LLM_BASE_URL = "https://api.example.com/v1";
    llmEnv.LLM_API_KEY = "test-key";
    llmEnv.LLM_MODEL = "test-model";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"items":[]}' } }] }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await refineClues(items);
    const init = fetchSpy.mock.calls[0]?.[1] as { body?: string } | undefined;
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ content: string }>;
    };
    const userContent = body.messages[1]?.content ?? "";
    expect(userContent).not.toContain("blog.csdn.net");
    expect(userContent).not.toContain("u1");
  });
});


describe("responses 协议（wire_api=responses）", () => {
  it("走 /responses、input 载荷，并解析 output[].content[].text", async () => {
    llmEnv.LLM_BASE_URL = "https://cn.fluxtoken.ai/v1";
    llmEnv.LLM_API_KEY = "test-key";
    llmEnv.LLM_MODEL = "gpt-6.2-sol";
    llmEnv.LLM_WIRE_API = "responses";
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        object: "response",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  items: [
                    {
                      index: 0,
                      isDemand: true,
                      score: 88,
                      reason: "缺发票截图自动整理工具",
                      title: "发票截图自动整理成报销表格",
                    },
                    { index: 1, isDemand: false },
                  ],
                }),
              },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await refineClues(items);
    const [url, init] = fetchSpy.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("https://cn.fluxtoken.ai/v1/responses");
    const body = JSON.parse(init.body) as { model: string; input: unknown; messages?: unknown };
    expect(body.model).toBe("gpt-6.2-sol");
    expect(Array.isArray(body.input)).toBe(true);
    expect(body.messages).toBeUndefined();

    expect(res.applied).toBe(true);
    expect(res.dropped).toBe(1);
    expect(res.items[0]!.title).toBe("发票截图自动整理成报销表格");
  });

  it("responses 返回顶层 output_text 时也能解析", async () => {
    llmEnv.LLM_BASE_URL = "https://cn.fluxtoken.ai/v1";
    llmEnv.LLM_API_KEY = "test-key";
    llmEnv.LLM_MODEL = "gpt-6.2-sol";
    llmEnv.LLM_WIRE_API = "responses";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output_text:
            '{"items":[{"index":0,"isDemand":true,"score":90,"reason":"缺排班工具","title":"排班工具"}]}',
        }),
      }),
    );
    const res = await refineClues(items);
    expect(res.applied).toBe(true);
    expect(res.items[0]!.title).toBe("排班工具");
  });
});

describe("主备模型回退（v0.6）", () => {
  beforeEach(() => {
    llmEnv.LLM_BASE_URL = "https://token.sensenova.cn/v1";
    llmEnv.LLM_API_KEY = "primary-key";
    llmEnv.LLM_MODEL = "sensenova-6.8-flash-lite";
    llmEnv.LLM_WIRE_API = "chat";
    llmEnv.LLM_FALLBACK_BASE_URL = "https://cn.fluxtoken.ai/v1";
    llmEnv.LLM_FALLBACK_API_KEY = "fallback-key";
    llmEnv.LLM_FALLBACK_MODEL = "gpt-6.1-terra";
    llmEnv.LLM_FALLBACK_WIRE_API = "responses";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("主模型报错时自动切到备用模型，并记录 provider", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (String(url).includes("sensenova.cn")) {
        return { ok: false, status: 503, json: async () => ({}) };
      }
      return {
        ok: true,
        json: async () => ({
          output: [
            { content: [{ type: "output_text", text: '{"items":[{"index":0,"isDemand":true,"score":90,"reason":"缺排班工具","title":"排班工具"}]}' }] },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await refineClues(items);
    expect(res.applied).toBe(true);
    expect(res.provider).toContain("fallback:gpt-6.1-terra");
    expect(res.items[0]!.title).toBe("排班工具");
    expect(fetchSpy.mock.calls.map((c) => String(c[0]))).toEqual([
      "https://token.sensenova.cn/v1/chat/completions",
      "https://cn.fluxtoken.ai/v1/responses",
    ]);
  });

  it("只配置备用模型时也能工作", async () => {
    llmEnv.LLM_BASE_URL = undefined;
    llmEnv.LLM_API_KEY = undefined;
    llmEnv.LLM_MODEL = undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          output_text: '{"items":[{"index":0,"isDemand":false}]}',
        }),
      }),
    );

    expect(isClueLlmEnabled()).toBe(true);
    const res = await refineClues(items);
    expect(res.applied).toBe(true);
    expect(res.provider).toBe("fallback:gpt-6.1-terra");
  });
});

describe("判定从严（v0.7：score 阈值 + reason 自证）", () => {
  const demand = {
    sourceKey: "csdn",
    externalId: "10",
    title: "求推荐一款自动排班软件",
    excerpt: "小店排班太麻烦，求一个能自动排班并通知员工的工具",
    url: "https://blog.csdn.net/a/10",
    authorId: "u10",
    mentionedAt: new Date(),
  } satisfies ClueItem;

  function stub(content: string) {
    llmEnv.LLM_BASE_URL = "https://api.example.com/v1";
    llmEnv.LLM_API_KEY = "test-key";
    llmEnv.LLM_MODEL = "test-model";
    llmEnv.LLM_WIRE_API = "chat";
    llmEnv.LLM_FALLBACK_BASE_URL = undefined;
    llmEnv.LLM_FALLBACK_API_KEY = undefined;
    llmEnv.LLM_FALLBACK_MODEL = undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }),
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("score 低于阈值时按非需求剔除", async () => {
    stub(JSON.stringify({ items: [{ index: 0, isDemand: true, score: 60, reason: "疑似", title: "排班工具" }] }));
    const res = await refineClues([demand]);
    expect(res.items).toHaveLength(0);
    expect(res.dropped).toBe(1);
  });

  it("判为需求但缺少 reason 自证时剔除", async () => {
    stub(JSON.stringify({ items: [{ index: 0, isDemand: true, score: 90, title: "排班工具" }] }));
    const res = await refineClues([demand]);
    expect(res.items).toHaveLength(0);
    expect(res.dropped).toBe(1);
  });

  it("score 与 reason 齐备时保留并替换标题", async () => {
    stub(
      JSON.stringify({
        items: [
          {
            index: 0,
            isDemand: true,
            score: 86,
            reason: "缺能自动排班并通知员工的工具",
            title: "求自动排班并通知员工的工具",
          },
        ],
      }),
    );
    const res = await refineClues([demand]);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.title).toBe("求自动排班并通知员工的工具");
    expect(res.dropped).toBe(0);
  });
});
