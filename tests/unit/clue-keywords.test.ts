import { describe, it, expect } from "vitest";
import {
  authorPseudonym,
  extractKeywords,
  isGenericTitle,
  isSamePain,
  looksLikeDemand,
  meaningfulKeywords,
  isLikelyNoise,
  isPromotionalTitle,
  sanitizeExcerpt,
  titleFingerprint,
} from "@/domain/clue/keywords";

describe("F29 关键词提取与匹配", () => {
  it("提取 ASCII 词与中文二元组，过滤停用词", () => {
    const kw = extractKeywords("有没有能把微信群会议通知自动整理成日程的工具 schedule tool");
    expect(kw).toContain("会议");
    expect(kw).toContain("日程");
    expect(kw).toContain("schedule");
    expect(kw).not.toContain("tool"); // 停用词
    expect(kw).not.toContain("有没"); // 中文虚词
  });

  it("标题指纹忽略标点、空白与大小写", () => {
    expect(titleFingerprint("求推荐：发票识别工具！")).toBe(
      titleFingerprint("求推荐 发票识别工具"),
    );
  });

  it("同一痛点的不同措辞可合并", () => {
    const a = {
      title: "有没有能把微信群里的会议通知自动整理成日程的工具",
      keywords: extractKeywords("有没有能把微信群里的会议通知自动整理成日程的工具"),
    };
    const b = {
      title: "想要一个把群聊里的会议通知整理成日程提醒的小工具",
      keywords: extractKeywords("想要一个把群聊里的会议通知整理成日程提醒的小工具"),
    };
    expect(isSamePain(a, b)).toBe(true);
  });

  it("不相关痛点不合并", () => {
    const a = {
      title: "有没有能把会议通知自动整理成日程的工具",
      keywords: extractKeywords("有没有能把会议通知自动整理成日程的工具"),
    };
    const b = {
      title: "求一个能把发票截图自动整理成报销表格的工具",
      keywords: extractKeywords("求一个能把发票截图自动整理成报销表格的工具"),
    };
    expect(isSamePain(a, b)).toBe(false);
  });
});

describe("F29 需求信号识别", () => {
  it("中文需求表达命中", () => {
    expect(looksLikeDemand("有没有能自动整理会议通知的工具")).toBe(true);
    expect(looksLikeDemand("求推荐一款发票识别软件")).toBe(true);
    expect(looksLikeDemand("想找一款小店排班表自动生成工具")).toBe(true);
  });

  it("英文需求表达命中", () => {
    expect(looksLikeDemand("I wish there was a tool that turns notes into tasks")).toBe(true);
    expect(looksLikeDemand("Somebody make a plugin for this")).toBe(true);
    expect(looksLikeDemand("Is there a tool that converts CSV to calendar?")).toBe(true);
  });

  it("普通新闻/闲聊不命中", () => {
    expect(looksLikeDemand("今天发布了 3.0 新版本，性能提升明显")).toBe(false);
    expect(looksLikeDemand("The company released its quarterly earnings report")).toBe(false);
  });
});

describe("F29 脱敏与伪名化", () => {
  it("手机号、身份证号、邮箱一律替换", () => {
    const raw = "联系我 13812345678，身份证 110101199001011234，邮箱 someone@example.com";
    const out = sanitizeExcerpt(raw);
    expect(out).not.toContain("13812345678");
    expect(out).not.toContain("110101199001011234");
    expect(out).not.toContain("someone@example.com");
    expect(out).toContain("[已脱敏]");
  });

  it("摘要截断 300 字并压缩空白", () => {
    const out = sanitizeExcerpt("需  求\n".repeat(300));
    expect(Array.from(out).length).toBeLessThanOrEqual(300);
    expect(out).not.toContain("\n");
  });

  it("作者伪名确定性且跨来源不同", () => {
    const a = authorPseudonym("v2ex", "user1");
    expect(a).toBe(authorPseudonym("v2ex", "user1"));
    expect(a).not.toBe(authorPseudonym("hn", "user1"));
    expect(a).not.toContain("user1");
    expect(a).toHaveLength(64);
  });
});

describe("泛化标题与聚合收口（v0.4）", () => {
  it("识别泛化标题：只剩句式与万能名词", () => {
    expect(isGenericTitle("有没有推荐的工具")).toBe(true);
    expect(isGenericTitle("求推荐一款软件")).toBe(true);
    expect(isGenericTitle("有没有更好的办法")).toBe(true);
    expect(isGenericTitle("想找一个工具")).toBe(true);
  });

  it("有具体主题的标题不算泛化", () => {
    expect(isGenericTitle("有没有好用的在线画图工具推荐？")).toBe(false);
    expect(isGenericTitle("想找一款小店排班表自动生成工具")).toBe(false);
    expect(isGenericTitle("有没有能把发票截图自动整理成报销表格的工具")).toBe(false);
  });

  it("泛化标题不参与聚合，即使句式完全相同", () => {
    const a = { title: "有没有推荐的工具", keywords: extractKeywords("有没有推荐的工具") };
    const b = { title: "有没有推荐的工具", keywords: extractKeywords("有没有推荐的工具") };
    expect(isSamePain(a, b)).toBe(false);
  });

  it("不同主题的具体需求不因共用句式而被合并", () => {
    const a = {
      title: "有没有好用的在线画图工具推荐？",
      keywords: extractKeywords("有没有好用的在线画图工具推荐？"),
    };
    const b = {
      title: "有没有好用的在线剪辑工具推荐？",
      keywords: extractKeywords("有没有好用的在线剪辑工具推荐？"),
    };
    expect(isSamePain(a, b)).toBe(false);
  });

  it("同一具体痛点的不同措辞仍能合并", () => {
    const a = {
      title: "有没有能把发票截图自动整理成报销表格的工具",
      keywords: extractKeywords("有没有能把发票截图自动整理成报销表格的工具"),
    };
    const b = {
      title: "求推荐发票截图批量识别生成报销表格的软件",
      keywords: extractKeywords("求推荐发票截图批量识别生成报销表格的软件"),
    };
    expect(isSamePain(a, b)).toBe(true);
  });

  it("有效关键词剔除万能词", () => {
    const kept = meaningfulKeywords(extractKeywords("有没有推荐的工具"));
    expect(kept.every((k) => !["工具", "推荐"].includes(k))).toBe(true);
  });
});

describe("需求信号判定收紧（v0.4）", () => {
  it("工具推介文不算需求（即使出现「痛点」）", () => {
    expect(
      looksLikeDemand("干货满满！推介几款 Mac 下非常好用的软件，解决你的痛点"),
    ).toBe(false);
    expect(looksLikeDemand("2025 最好用的 AI 工具大全推荐，建议收藏")).toBe(false);
  });

  it("用户自述痛点或求取仍算需求", () => {
    expect(looksLikeDemand("痛点在于每天手动录入报销单，太费时间")).toBe(true);
    expect(looksLikeDemand("有没有好用的在线画图工具推荐？")).toBe(true);
    expect(looksLikeDemand("求助：团队会议通知总是漏看怎么办")).toBe(true);
  });
});

describe("强广告噪声过滤（v0.5）", () => {
  it("招生/拉私域/招聘类直接判为噪声", () => {
    expect(isLikelyNoise("Java 训练营招生中，扫码关注领取资料")).toBe(true);
    expect(isLikelyNoise("内推岗位，简历投递请私信")).toBe(true);
    expect(isLikelyNoise("限时优惠，优惠券免费领取")).toBe(true);
  });

  it("教程/源码/求助类不判为噪声（交给大模型判定）", () => {
    expect(isLikelyNoise("Vue3 实战教程与源码解析")).toBe(false);
    expect(isLikelyNoise("求推荐一个好用的本地 OCR 工具")).toBe(false);
  });
});

describe("推介/盘点标题兜底（v0.6）", () => {
  it("盘点、亲测、教程类标题判为推介文", () => {
    expect(isPromotionalTitle("FTP工具哪个好用？六款亲测好用的FTP工具分享")).toBe(true);
    expect(isPromotionalTitle("2019自动化测试工具Top10")).toBe(true);
    expect(isPromotionalTitle("Google发布浏览器自动化工具Puppeteer 1.0")).toBe(true);
    expect(isPromotionalTitle("PS自动抠图方法详解")).toBe(true);
  });

  it("真实需求标题不受影响", () => {
    expect(isPromotionalTitle("寻找Wappalyzer替代工具以显示完整技术栈")).toBe(false);
    expect(isPromotionalTitle("求推荐类似 Worktile 的项目管理软件")).toBe(false);
    expect(isPromotionalTitle("适用于 macOS 的免费远程控制软件")).toBe(false);
  });
});
