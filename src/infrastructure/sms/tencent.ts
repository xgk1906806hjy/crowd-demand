/**
 * 腾讯云短信适配器（零 SDK 依赖，直接调用 API + TC3-HMAC-SHA256 签名）。
 * API：sms.tencentcloudapi.com SendSms（Version 2021-01-11）。
 * 签名规则：https://cloud.tencent.com/document/api/213/30654（TC3 签名）
 *
 * 配置：TENCENT_SMS_SECRET_ID / TENCENT_SMS_SECRET_KEY / TENCENT_SMS_SDK_APP_ID /
 *       TENCENT_SMS_SIGN_NAME / TENCENT_SMS_TEMPLATE_ID / TENCENT_SMS_REGION（默认 ap-guangzhou）
 * 前提：签名与模板已在腾讯云控制台审核通过；模板变量为 {1}（验证码）。
 */
import { createHash, createHmac } from "node:crypto";
import { env } from "@/lib/env";
import type { SmsGateway } from "@/infrastructure/sms/gateway";

const HOST = "sms.tencentcloudapi.com";
const SERVICE = "sms";
const ACTION = "SendSms";
const VERSION = "2021-01-11";

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

export interface TencentSmsConfig {
  secretId: string;
  secretKey: string;
  sdkAppId: string;
  signName: string;
  templateId: string;
  region: string;
}

export function tencentConfigFromEnv(): TencentSmsConfig {
  const cfg = {
    secretId: env.TENCENT_SMS_SECRET_ID ?? "",
    secretKey: env.TENCENT_SMS_SECRET_KEY ?? "",
    sdkAppId: env.TENCENT_SMS_SDK_APP_ID ?? "",
    signName: env.TENCENT_SMS_SIGN_NAME ?? "",
    templateId: env.TENCENT_SMS_TEMPLATE_ID ?? "",
    region: env.TENCENT_SMS_REGION || "ap-guangzhou",
  };
  const missing: string[] = [];
  if (!cfg.secretId) missing.push("TENCENT_SMS_SECRET_ID");
  if (!cfg.secretKey) missing.push("TENCENT_SMS_SECRET_KEY");
  if (!cfg.sdkAppId) missing.push("TENCENT_SMS_SDK_APP_ID");
  if (!cfg.signName) missing.push("TENCENT_SMS_SIGN_NAME");
  if (!cfg.templateId) missing.push("TENCENT_SMS_TEMPLATE_ID");
  if (missing.length) {
    throw new Error(`SMS_ADAPTER=tencent 但缺少配置：${missing.join(", ")}`);
  }
  return cfg;
}

/** 构造 TC3 签名请求（timestamp 可注入，便于测试）。 */
export function buildTencentSendSmsRequest(
  cfg: TencentSmsConfig,
  phone: string,
  code: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): { url: string; headers: Record<string, string>; body: string } {
  const payload = JSON.stringify({
    PhoneNumberSet: [`+86${phone}`],
    SmsSdkAppId: cfg.sdkAppId,
    SignName: cfg.signName,
    TemplateId: cfg.templateId,
    TemplateParamSet: [code],
  });
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = "application/json; charset=utf-8";

  const canonicalRequest = [
    "POST",
    "/",
    "",
    `content-type:${contentType}`,
    `host:${HOST}`,
    "",
    "content-type;host",
    sha256Hex(payload),
  ].join("\n");

  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", String(timestamp), credentialScope, sha256Hex(canonicalRequest)].join("\n");

  const secretDate = hmac(`TC3${cfg.secretKey}`, date);
  const secretService = hmac(secretDate, SERVICE);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = createHmac("sha256", secretSigning).update(stringToSign).digest("hex");

  const authorization =
    `TC3-HMAC-SHA256 Credential=${cfg.secretId}/${credentialScope}, ` +
    `SignedHeaders=content-type;host, Signature=${signature}`;

  return {
    url: `https://${HOST}`,
    headers: {
      "content-type": contentType,
      host: HOST,
      authorization,
      "x-tc-action": ACTION,
      "x-tc-version": VERSION,
      "x-tc-region": cfg.region,
      "x-tc-timestamp": String(timestamp),
    },
    body: payload,
  };
}

interface TencentSendResponse {
  Response?: {
    Error?: { Code?: string; Message?: string };
    SendStatusSet?: Array<{ Code?: string; Message?: string }>;
    RequestId?: string;
  };
}

export class TencentSmsGateway implements SmsGateway {
  constructor(private readonly cfg: TencentSmsConfig = tencentConfigFromEnv()) {}

  async sendCode({ phone, code }: { phone: string; code: string; purpose: string }) {
    const req = buildTencentSendSmsRequest(this.cfg, phone, code);
    const res = await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: req.body,
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json()) as TencentSendResponse;
    const err = data.Response?.Error;
    if (err) {
      throw new Error(`腾讯云短信发送失败：${err.Code ?? ""} ${err.Message ?? ""}`.trim());
    }
    const status = data.Response?.SendStatusSet?.[0];
    if (!status || status.Code !== "Ok") {
      throw new Error(`腾讯云短信发送失败：${status?.Code ?? res.status} ${status?.Message ?? ""}`.trim());
    }
    console.info(`[TencentSms] sent requestId=${data.Response?.RequestId ?? "-"}`);
  }
}
