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
});

// 合规红线：生产环境禁止使用 mock 支付适配器处理真实资金
export function assertProductionPaymentSafe(nodeEnv = process.env.NODE_ENV): void {
  if (nodeEnv === "production" && env.PAYMENT_ADAPTER === "mock") {
    throw new Error("合规红线：生产环境禁止使用 mock 支付适配器");
  }
}
