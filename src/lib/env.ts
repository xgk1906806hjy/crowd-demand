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
  /** 内部定时任务密钥；未配置时 /api/internal/cron 一律拒绝 */
  CRON_SECRET: z.string().min(16).optional(),
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
  CRON_SECRET: process.env.CRON_SECRET,
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
