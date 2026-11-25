import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  AUTH_SECRET: z.string().min(16),
  SMS_ADAPTER: z.enum(["mock", "aliyun", "tencent"]).default("mock"),
  EMAIL_ADAPTER: z.enum(["mock", "smtp"]).default("mock"),
  PAYMENT_ADAPTER: z.enum(["mock", "licensed"]).default("mock"),
  KYC_ADAPTER: z.enum(["mock", "third-party"]).default("mock"),
  MAX_PLEDGE_AMOUNT_CENTS: z.string().default("5000000"),
  MAX_USER_PLEDGE_CENTS: z.string().default("20000000"),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  /**
   * 部署环境语义：production（默认，最严格）| demo（演示/预发）。
   * demo 仅用于内部演示，可显式放行 Mock 支付适配器，绝不处理真实资金。
   */
  APP_ENV: z.enum(["production", "demo"]).default("production"),

  /**
   * 会话 Cookie 的 Secure 属性策略。
   * auto（默认）：按 X-Forwarded-Proto 判断，https 才加 Secure；
   * true/false：强制开/关。HTTP 演示站需 auto 或 false，否则浏览器会丢弃 Secure Cookie。
   */
  SESSION_COOKIE_SECURE: z.enum(["auto", "true", "false"]).default("auto"),
  /** 内部定时任务密钥；未配置时 /api/internal/cron 一律拒绝 */
  CRON_SECRET: z.string().min(16).optional(),

  // ---------- F29 平台需求采集 ----------
  /** 采集来源，逗号分隔：csdn / weixin / juejin / douyin / kuaishou（国内）/ hn / v2ex / reddit（海外）/ websearch */
  CLUE_SOURCES: z.string().default("csdn,weixin,juejin,douyin,kuaishou,hn"),
  /** 采集节流间隔（分钟）：cron 每 5 分钟触发，但外部抓取按此间隔执行（v0.8 默认 10 分钟） */
  CLUE_INGEST_INTERVAL_MIN: z.string().default("10"),
  /** 小时聚合分析间隔（分钟）：把该窗口内 6 轮候选合并交模型聚类（v0.8） */
  CLUE_ANALYZE_INTERVAL_MIN: z.string().default("60"),
  /** 单来源 HTTP 超时（毫秒） */
  CLUE_FETCH_TIMEOUT_MS: z.string().default("15000"),
  /** 小时聚合窗口内最多送模型的候选条数 */
  CLUE_ANALYZE_MAX_ITEMS: z.string().default("200"),
  /** 单轮使用的检索词条数（按轮次在词表上轮换，v0.8 默认 4） */
  CLUE_QUERIES_PER_ROUND: z.string().default("4"),
  /** 可选：联网搜索 API（OpenAI 兼容的 /search 或自定义 base），未配置则 websearch 来源停用 */
  CLUE_SEARCH_API_URL: z.string().optional(),
  CLUE_SEARCH_API_KEY: z.string().optional(),
  /** 轮次直接入库开关：v0.8 默认 false，改为每小时聚合分析后统一入库 */
  CLUE_ROUND_INGEST: z.enum(["true", "false"]).default("false"),

  // ---------- 可选：大模型整合（OpenAI 兼容接口） ----------
  /** 主模型；形如 https://api.deepseek.com/v1；BASE_URL/KEY/MODEL 三项齐备才启用，否则走规则聚合 */
  LLM_BASE_URL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  /** 接口协议：chat（/chat/completions，默认）| responses（/responses） */
  LLM_WIRE_API: z.enum(["chat", "responses"]).default("chat"),

  // ---------- 可选：备用模型（主模型调用失败时自动回退） ----------
  LLM_FALLBACK_BASE_URL: z.string().optional(),
  LLM_FALLBACK_API_KEY: z.string().optional(),
  LLM_FALLBACK_MODEL: z.string().optional(),
  LLM_FALLBACK_WIRE_API: z.enum(["chat", "responses"]).default("chat"),

  // ---------- 真实邮件（EMAIL_ADAPTER=smtp 时必填 host/user/pass） ----------
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().default("465"),
  SMTP_SECURE: z.enum(["true", "false"]).default("true"),
  SMTP_USER: z.string().optional(),
  /** QQ/163 为 SMTP 授权码，不是邮箱登录密码 */
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // ---------- 阿里云短信（SMS_ADAPTER=aliyun 时必填） ----------
  ALIYUN_SMS_ACCESS_KEY_ID: z.string().optional(),
  ALIYUN_SMS_ACCESS_KEY_SECRET: z.string().optional(),
  ALIYUN_SMS_SIGN_NAME: z.string().optional(),
  ALIYUN_SMS_TEMPLATE_CODE: z.string().optional(),
  ALIYUN_SMS_TEMPLATE_PARAM: z.string().default("code"),

  // ---------- 腾讯云短信（SMS_ADAPTER=tencent 时必填） ----------
  TENCENT_SMS_SECRET_ID: z.string().optional(),
  TENCENT_SMS_SECRET_KEY: z.string().optional(),
  TENCENT_SMS_SDK_APP_ID: z.string().optional(),
  TENCENT_SMS_SIGN_NAME: z.string().optional(),
  TENCENT_SMS_TEMPLATE_ID: z.string().optional(),
  TENCENT_SMS_REGION: z.string().default("ap-guangzhou"),
});

export const env = schema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  AUTH_SECRET: process.env.AUTH_SECRET,
  SMS_ADAPTER: process.env.SMS_ADAPTER,
  EMAIL_ADAPTER: process.env.EMAIL_ADAPTER,
  PAYMENT_ADAPTER: process.env.PAYMENT_ADAPTER,
  KYC_ADAPTER: process.env.KYC_ADAPTER,
  MAX_PLEDGE_AMOUNT_CENTS: process.env.MAX_PLEDGE_AMOUNT_CENTS,
  MAX_USER_PLEDGE_CENTS: process.env.MAX_USER_PLEDGE_CENTS,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  APP_ENV: process.env.APP_ENV,
  SESSION_COOKIE_SECURE: process.env.SESSION_COOKIE_SECURE,
  CRON_SECRET: process.env.CRON_SECRET,
  CLUE_SOURCES: process.env.CLUE_SOURCES,
  CLUE_INGEST_INTERVAL_MIN: process.env.CLUE_INGEST_INTERVAL_MIN,
  CLUE_ANALYZE_INTERVAL_MIN: process.env.CLUE_ANALYZE_INTERVAL_MIN,
  CLUE_FETCH_TIMEOUT_MS: process.env.CLUE_FETCH_TIMEOUT_MS,
  CLUE_ANALYZE_MAX_ITEMS: process.env.CLUE_ANALYZE_MAX_ITEMS,
  CLUE_QUERIES_PER_ROUND: process.env.CLUE_QUERIES_PER_ROUND,
  CLUE_SEARCH_API_URL: process.env.CLUE_SEARCH_API_URL,
  CLUE_SEARCH_API_KEY: process.env.CLUE_SEARCH_API_KEY,
  CLUE_ROUND_INGEST: process.env.CLUE_ROUND_INGEST,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
  LLM_WIRE_API: process.env.LLM_WIRE_API,
  LLM_FALLBACK_BASE_URL: process.env.LLM_FALLBACK_BASE_URL,
  LLM_FALLBACK_API_KEY: process.env.LLM_FALLBACK_API_KEY,
  LLM_FALLBACK_MODEL: process.env.LLM_FALLBACK_MODEL,
  LLM_FALLBACK_WIRE_API: process.env.LLM_FALLBACK_WIRE_API,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_SECURE: process.env.SMTP_SECURE,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,
  ALIYUN_SMS_ACCESS_KEY_ID: process.env.ALIYUN_SMS_ACCESS_KEY_ID,
  ALIYUN_SMS_ACCESS_KEY_SECRET: process.env.ALIYUN_SMS_ACCESS_KEY_SECRET,
  ALIYUN_SMS_SIGN_NAME: process.env.ALIYUN_SMS_SIGN_NAME,
  ALIYUN_SMS_TEMPLATE_CODE: process.env.ALIYUN_SMS_TEMPLATE_CODE,
  ALIYUN_SMS_TEMPLATE_PARAM: process.env.ALIYUN_SMS_TEMPLATE_PARAM,
  TENCENT_SMS_SECRET_ID: process.env.TENCENT_SMS_SECRET_ID,
  TENCENT_SMS_SECRET_KEY: process.env.TENCENT_SMS_SECRET_KEY,
  TENCENT_SMS_SDK_APP_ID: process.env.TENCENT_SMS_SDK_APP_ID,
  TENCENT_SMS_SIGN_NAME: process.env.TENCENT_SMS_SIGN_NAME,
  TENCENT_SMS_TEMPLATE_ID: process.env.TENCENT_SMS_TEMPLATE_ID,
  TENCENT_SMS_REGION: process.env.TENCENT_SMS_REGION,
});

const warnedAdapters = new Set<string>();

/**
 * 统一合规闸门：生产构建下禁止使用 Mock 外部适配器（支付/短信/实名等）。
 * 仅当显式声明 APP_ENV=demo 时放行（内部演示实例），并打印一次醒目告警。
 */
export function assertMockAdapterAllowed(
  kind: "支付" | "短信" | "实名" | "邮件",
  nodeEnv = process.env.NODE_ENV,
): void {
  if (nodeEnv !== "production") return;

  if (env.APP_ENV === "demo") {
    if (!warnedAdapters.has(kind)) {
      warnedAdapters.add(kind);
      console.warn(
        `[compliance] APP_ENV=demo：生产构建正在使用 Mock ${kind}适配器。` +
          "该实例仅供内部演示/验收，严禁对外提供真实服务或收取任何款项。",
      );
    }
    return;
  }

  throw new Error(
    `合规红线：生产环境禁止使用 mock ${kind}适配器。` +
      `请接入正式服务商；若确为内部演示实例，请显式设置 APP_ENV=demo。`,
  );
}

// 合规红线：生产环境禁止使用 mock 支付适配器处理真实资金
export function assertProductionPaymentSafe(nodeEnv = process.env.NODE_ENV): void {
  if (env.PAYMENT_ADAPTER !== "mock") return;
  assertMockAdapterAllowed("支付", nodeEnv);
}
