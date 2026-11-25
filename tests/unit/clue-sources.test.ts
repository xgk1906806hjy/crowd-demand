import { describe, it, expect } from "vitest";
import { parseCsdn } from "@/infrastructure/clue/csdn";
import { parseWeixin } from "@/infrastructure/clue/weixin";
import { parseJuejin } from "@/infrastructure/clue/juejin";

describe("parseCsdn（CSDN 检索结果）", () => {
  it("清洗 <em> 高亮、按 articleid 归一、毫秒时间戳转 Date", () => {
    const payload = {
      result_vos: [
        {
          articleid: "147991963",
          title: "2025 最好用的 AI <em>工具</em>大全<em>推荐</em>",
          url: "https://blog.csdn.net/x/article/details/147991963",
          description: "本文整理了 AI<em>工具</em>清单",
          create_time: "1747238400000",
          nickname: "大模型入门教程",
        },
        { title: "", url: "https://blog.csdn.net/bad" },
      ],
    };
    const items = parseCsdn(payload);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("2025 最好用的 AI 工具大全推荐");
    expect(items[0]!.excerpt).toBe("本文整理了 AI工具清单");
    expect(items[0]!.externalId).toBe("147991963");
    expect(items[0]!.sourceKey).toBe("csdn");
    expect(items[0]!.mentionedAt.getUTCFullYear()).toBe(2025);
  });

  it("异常结构返回空数组而不抛错", () => {
    expect(parseCsdn(null)).toEqual([]);
    expect(parseCsdn({ result_vos: "x" })).toEqual([]);
  });
});

describe("parseWeixin（微信公众号检索结果）", () => {
  const html = `
  <li id="sogou_vr_11002601_box_0" d="ab735a258a90e8e1-6bee54fcbd896b2a-6dab11039f7249a223485cc0c594dbf7">
  <div class="txt-box">
  <h3>
  <a target="_blank" href="/link?url=abc&amp;type=2&amp;query=x&amp;token=TOK123" id="sogou_vr_11002601_title_0">被241家品牌<em><!--red_beg-->推荐<!--red_end--></em>的私域<em><!--red_beg-->工具<!--red_end--></em>清单</a>
  </h3>
  <p class="txt-info" id="sogou_vr_11002601_summary_0">28家<em>工具</em>商被推荐，反映当下选择。</p>
  <div class="s-p">
  <span class="all-time-y2">见实</span><span class="s2"><script>document.write(timeConvert('1713060126'))</script></span>
  </div>
  </div>
  </li>
  <li id="sogou_vr_11002601_box_1" d="other-fingerprint">
  <div class="txt-box">
  <h3><a href="/link?url=def&amp;token=TOK999">有没有好用的排班软件</a></h3>
  <p class="txt-info">想找能自动排班的工具</p>
  </div>
  </li>`;

  it("提取标题/摘要/公众号/时间，链接补全域名", () => {
    const items = parseWeixin(html);
    expect(items).toHaveLength(2);
    expect(items[0]!.title).toBe("被241家品牌推荐的私域工具清单");
    expect(items[0]!.excerpt).toContain("28家工具商被推荐");
    expect(items[0]!.url.startsWith("https://weixin.sogou.com/link?")).toBe(true);
    expect(items[0]!.url).toContain("&type=2");
    expect(items[0]!.authorId).toBe("见实");
    expect(items[0]!.externalId).toBe("ab735a258a90e8e1-6bee54fcbd896b2a-6dab11039f7249a223485cc0c594dbf7");
    expect(items[0]!.mentionedAt.getUTCFullYear()).toBe(2024);
    expect(items[1]!.title).toBe("有没有好用的排班软件");
  });

  it("空页面返回空数组", () => {
    expect(parseWeixin("<html></html>")).toEqual([]);
  });
});

describe("parseJuejin（掘金检索结果）", () => {
  it("读取 result_model.article_info，拼装文章链接", () => {
    const payload = {
      data: [
        {
          result_model: {
            article_info: {
              article_id: "7300000000000000000",
              title: "推荐几款实用工具",
              brief_content: "整理了一些提升效率的工具",
              ctime: "1713060126",
            },
            author_user_info: { user_name: "掘金用户" },
          },
        },
        { result_model: {} },
      ],
    };
    const items = parseJuejin(payload);
    expect(items).toHaveLength(1);
    expect(items[0]!.url).toBe("https://juejin.cn/post/7300000000000000000");
    expect(items[0]!.sourceKey).toBe("juejin");
    expect(items[0]!.authorId).toBe("掘金用户");
    expect(items[0]!.mentionedAt.getUTCFullYear()).toBe(2024);
  });

  it("异常结构返回空数组", () => {
    expect(parseJuejin(undefined)).toEqual([]);
    expect(parseJuejin({ data: {} })).toEqual([]);
  });
});

