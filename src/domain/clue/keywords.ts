import { createHash } from "node:crypto";

/**
 * F29 线索聚合的纯函数：关键词提取、需求信号识别、相似度匹配、脱敏。
 * 全部无副作用，便于单测锚定行为。
 */

const ASCII_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "there", "have", "has", "was", "are",
  "you", "your", "can", "could", "would", "should", "will", "just", "any", "some",
  "tool", "app", "way", "site", "want", "wish", "need", "looking", "make", "does",
  "anyone", "know", "something", "someone", "please", "help", "from", "what", "how",
  "why", "isn", "isnt", "get", "got", "use", "using", "but", "not", "all", "out",
]);

/** 中文虚词二元组：不构成痛点内容，参与匹配会造成误合并。 */
const CJK_STOP_BIGRAMS = new Set([
  "我们", "大家", "一个", "有没", "没有", "什么", "怎么", "可以", "这个", "那个",
  "希望", "想要", "如果", "要是", "就是", "还是", "或者", "但是", "因为", "所以",
  "现在", "时候", "感觉", "觉得", "有木", "求推", "求助", "求个", "跪求", "能不能",
]);

/**
 * 需求表达的模板短语：剥离后只对「痛点名词」生成二元组，
 * 避免「有没有能把 X 自动整理成 Y 的工具」这类句式骨架导致误合并。
 * 按长度降序剥离。
 */
const CJK_TEMPLATE_PHRASES = [
  "想要一个", "有没有", "求推荐", "求一个", "能不能", "的小工具", "小工具",
  "的工具", "的软件", "整理成", "想要", "能把", "自动", "整理", "生成",
  "识别", "工具", "软件", "插件", "一款", "一个",
].sort((a, b) => b.length - a.length);

function stripTemplates(text: string): string {
  let out = text;
  for (const p of CJK_TEMPLATE_PHRASES) out = out.split(p).join(" ");
  return out;
}

/** 提取关键词：ASCII 词（≥3 字符，去停用词）+ 中文连续段的二元组。 */
export function extractKeywords(text: string): string[] {
  const lower = text.toLowerCase();
  const out = new Set<string>();

  for (const m of lower.matchAll(/[a-z][a-z0-9+#]{2,}/g)) {
    const w = m[0];
    if (!ASCII_STOPWORDS.has(w)) out.add(w);
  }

  for (const m of stripTemplates(text).matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const run = m[0];
    for (let i = 0; i + 2 <= run.length; i++) {
      const bg = run.slice(i, i + 2);
      if (!CJK_STOP_BIGRAMS.has(bg)) out.add(bg);
    }
  }

  return Array.from(out).slice(0, 48);
}

/** 标题指纹：去空白与标点、小写，用于完全相同标题的快速合并。 */
export function titleFingerprint(title: string): string {
  return title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

/**
 * 泛化标题判定（v0.4）：去掉需求句式与万能名词后，剩余具体信息不足 4 字。
 * 例：「有没有推荐的工具」「求推荐一款软件」「有没有更好的办法」→ 泛化。
 * 「有没有好用的在线画图工具推荐？」去掉句式后剩「在线画图」→ 非泛化。
 * 泛化标题不参与聚合，避免不同主题被同一句式骨架错误合并成一个大杂烩。
 */
const GENERIC_TITLE_WORDS = [
  "有没有", "有木有", "求推荐", "求一个", "求个", "跪求", "想找", "谁能", "帮我", "麻烦",
  "请问", "求问", "什么", "好用", "更好", "最好", "推荐", "工具", "软件", "插件", "app",
  "方案", "办法", "东西", "产品", "平台", "应用", "网站", "系统", "一款", "一个", "一下",
  "那种", "哪种", "大佬", "求助", "怎么", "怎样", "如何",
];

export function isGenericTitle(title: string): boolean {
  let rest = title.toLowerCase();
  for (const word of GENERIC_TITLE_WORDS) rest = rest.split(word).join(" ");
  const cjk = (rest.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const ascii = (rest.match(/[a-z]{3,}/g) ?? []).length;
  return cjk < 4 && ascii < 1;
}

/** 聚合用的有效关键词：剔除「工具/推荐/办法」这类万能词，只留具体主题。 */
const CJK_GENERIC_BIGRAMS = new Set([
  "工具", "软件", "推荐", "办法", "方案", "东西", "产品", "平台", "应用", "网站",
  "系统", "好用", "什么", "怎么", "怎样", "如何", "哪里", "哪个", "哪种", "可以",
  "需要", "希望", "想要", "有没", "没有", "请问", "求助", "大佬", "求推", "求个",
]);

export function meaningfulKeywords(keywords: string[]): string[] {
  return keywords.filter((k) => {
    if (CJK_GENERIC_BIGRAMS.has(k)) return false;
    // 滑窗产生的虚词二元组（"用的""的在""了的"）不承载主题，参与匹配只会造成误合并
    if (/[的了是]/.test(k)) return false;
    return true;
  });
}

/**
 * 两条线索是否同一痛点（v0.4 收紧）：
 * - 泛化标题不参与聚合（既不用指纹，也不用关键词），宁可漏合并也不误合并；
 * - 标题指纹相同 → 合并；
 * - 有效关键词交集 ≥3 且交集/较小集合 ≥0.4 → 合并。
 */
export function isSamePain(
  a: { title: string; keywords: string[] },
  b: { title: string; keywords: string[] },
): boolean {
  if (isGenericTitle(a.title) || isGenericTitle(b.title)) return false;
  if (titleFingerprint(a.title) === titleFingerprint(b.title)) return true;

  const setB = new Set(meaningfulKeywords(b.keywords));
  let inter = 0;
  for (const k of meaningfulKeywords(a.keywords)) if (setB.has(k)) inter++;
  const minSize = Math.min(
    meaningfulKeywords(a.keywords).length,
    meaningfulKeywords(b.keywords).length,
  );
  if (minSize === 0) return false;
  return inter >= 3 && inter / minSize >= 0.4;
}

const ZH_DEMAND_PATTERNS: RegExp[] = [
  /求推荐|求一个|求个|跪求|有偿求|求购/,
  /有没有(什么|人|工具|软件|办法|可能)?/,
  /想找|找一款|找个.*(工具|软件|插件|方案)/,
  /谁能(做|帮|开发)|能不能(做|开发|搞)|谁会做/,
  /要是能.{0,20}就好|如果能.{0,20}就好|建议(做|开发|出)/,
  /求助|急求|有偿求/,
  // 单说「痛点」多为工具推介文（"解决你的痛点"），只在明确自述痛点时才算需求
  /痛点(在于|是|：|:)/,
];

const EN_DEMAND_PATTERNS: RegExp[] = [
  /i wish (there|someone|somebody)/i,
  /is there (a|an|any)\b[^.?!]{0,60}\b(tool|app|way|site|service|software|extension)/i,
  /looking for (a|an|any|some)/i,
  /somebody make|someone should (make|build)/i,
  /would (pay|love) (for|to)/i,
  /why (isn't|isnt|is there no) there/i,
  /does anyone know (a|an|of|any)/i,
  /need (a|an) (tool|app|way|script|extension)/i,
];

/** 是否像一条「需求/痛点」表达，而不是普通新闻或闲聊。 */
export function looksLikeDemand(text: string): boolean {
  return (
    ZH_DEMAND_PATTERNS.some((r) => r.test(text)) ||
    EN_DEMAND_PATTERNS.some((r) => r.test(text))
  );
}

/**
 * 明显广告/招生/拉私域类内容，交给大模型判定前直接丢弃，省 token。
 * 注意只放强信号词：教程、源码、实战等中性词不能进这里，中文社区的真实求助常与它们同时出现。
 */
const NOISE_PATTERNS: RegExp[] = [
  /培训班|训练营|招生|报名入口|课程优惠|限时优惠|优惠券|免费领取|扫码关注|加微信|私信领取/,
  /招聘|内推|简历投递|面经分享|薪资待遇/,
  // 学生作业、考试题、代做代写不属于产品需求
  /作业|考试|题目|题库|课设|课程设计|毕设|毕业设计|期末|刷题|leetcode|力扣/i,
  // 具体报错/堆栈排查也不是「缺一个产品」
  /报错|Exception|Traceback|stack ?trace|\bat\s+\w+\.(java|py|ts|js|go|cs):?\d+/i,
];

export function isLikelyNoise(text: string): boolean {
  return NOISE_PATTERNS.some((r) => r.test(text));
}

/**
 * 推介/盘点类标题（v0.6）：轻量模型容易把「XX 工具盘点」「亲测几款」判成需求，
 * 这里按标题特征再兜一层。只看标题：摘要里出现「推荐」很常见，容易误杀。
 */
const PROMO_PATTERNS: RegExp[] = [
  /盘点|排行榜|合集|大全|年度|避坑|指南|教程|详解|亲测|几款|六款|十款|款好用的|工具分享|软件分享/,
  /top\s*10|top\s*5|十大|最佳工具/i,
  /发布了|正式发布|上线了|宣布推出|正式推出|发布|新鲜出炉|开源了|自研|我做了个|我开发了/,
];

export function isPromotionalTitle(title: string): boolean {
  return PROMO_PATTERNS.some((r) => r.test(title));
}

/**
 * 公开摘要脱敏：手机号、身份证号、邮箱一律替换，压缩空白，截断 300 字。
 * 合规红线：不得存储个人信息（PRD 5.10）。
 */
export function sanitizeExcerpt(text: string): string {
  const cleaned = text
    .replace(/\b1[3-9]\d{9}\b/g, "[已脱敏]")
    .replace(/\b\d{17}[\dXx]\b/g, "[已脱敏]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[已脱敏]")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(cleaned).slice(0, 300).join("");
}

/** 作者伪名化：只存不可逆哈希，用于「提及人数」去重，不存平台原始 ID。 */
export function authorPseudonym(sourceKey: string, authorId: string): string {
  return createHash("sha256").update(`${sourceKey}:${authorId}`).digest("hex");
}
