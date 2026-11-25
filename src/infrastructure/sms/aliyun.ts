/**
 * 阿里云短信适配器（零 SDK 依赖，直接调用 RPC API + HMAC-SHA1 签名）。
 * API：dysmsapi.aliyuncs.com SendSms（Version 2017-05-25）。
 * 签名规则：https://help.aliyun.com/document_detail/315526.html（RPC V1 签名）
 *
 * 配置：ALIYUN_SMS_ACCESS_KEY_ID / ALIYUN_SMS_ACCESS_KEY_SECRET /
 *       ALIYUN_SMS_SIGN_NAME / ALIYUN_SMS_TEMPLATE_CODE / ALIYUN_SMS_TEMPLATE_PARAM（默认 code）
 * 前提：签名与模板已在阿里云控制台审核通过；模板变量形如 ${code}。
 */
import { createHmac, randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import type { SmsGateway } from "@/infrastructure/sms/gateway";

/** 阿里云 RPC 专用 percentEncode（RFC3986）。 */
export function aliyunPercentEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
}

/** 计算 RPC V1 签名（导出以便用官方文档向量做单测）。 */
export function signAliyunRpc(params: Record<string, string>, accessKeySecret: string): string {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${aliyunPercentEncode(k)}=${aliyunPercentEncode(params[k] ?? "")}`)
    .join("&");
  const stringToSign = `GET&${aliyunPercentEncode("/")}&${aliyunPercentEncode(canonical)}`;
  return createHmac("sha1", `${accessKeySecret}&`).update(stringToSign).digest("base64");
}

export interface AliyunSmsConfig {
  accessKeyId: string;
  accessKeySecret: string;
  signName: string;
  templateCode: string;
  /** 模板中验证码变量名，默认 code（对应模板 ${code}） */
  templateParam: string;
}

export function aliyunConfigFromEnv(): AliyunSmsConfig {
  const cfg = {
    accessKeyId: env.ALIYUN_SMS_ACCESS_KEY_ID ?? "",
    accessKeySecret: env.ALIYUN_SMS_ACCESS_KEY_SECRET ?? "",
    signName: env.ALIYUN_SMS_SIGN_NAME ?? "",
    templateCode: env.ALIYUN_SMS_TEMPLATE_CODE ?? "",
    templateParam: env.ALIYUN_SMS_TEMPLATE_PARAM || "code",
  };
  const missing: string[] = [];
  if (!cfg.accessKeyId) missing.push("ALIYUN_SMS_ACCESS_KEY_ID");
  if (!cfg.accessKeySecret) missing.push("ALIYUN_SMS_ACCESS_KEY_SECRET");
  if (!cfg.signName) missing.push("ALIYUN_SMS_SIGN_NAME");
  if (!cfg.templateCode) missing.push("ALIYUN_SMS_TEMPLATE_CODE");
  if (missing.length) {
    throw new Error(`SMS_ADAPTER=aliyun 但缺少配置：${missing.join(", ")}`);
  }
  return cfg;
}

/** 构造完整请求 URL（now/nonce 可注入，便于测试）。 */
export function buildAliyunSendSmsUrl(
  cfg: AliyunSmsConfig,
  phone: string,
  code: string,
  now: Date = new Date(),
  nonce: string = randomUUID(),
): string {
  const params: Record<string, string> = {
    AccessKeyId: cfg.accessKeyId,
    Action: "SendSms",
    Format: "JSON",
    PhoneNumbers: phone,
    RegionId: "cn-hangzhou",
    SignName: cfg.signName,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: nonce,
    SignatureVersion: "1.0",
    TemplateCode: cfg.templateCode,
    TemplateParam: JSON.stringify({ [cfg.templateParam]: code }),
    Timestamp: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: "2017-05-25",
  };
  const signature = signAliyunRpc(params, cfg.accessKeySecret);
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${aliyunPercentEncode(k)}=${aliyunPercentEncode(params[k] ?? "")}`)
    .join("&");
  return `https://dysmsapi.aliyuncs.com/?Signature=${aliyunPercentEncode(signature)}&${canonical}`;
}

export class AliyunSmsGateway implements SmsGateway {
  constructor(private readonly cfg: AliyunSmsConfig = aliyunConfigFromEnv()) {}

  async sendCode({ phone, code }: { phone: string; code: string; purpose: string }) {
    const url = buildAliyunSendSmsUrl(this.cfg, phone, code);
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const data = (await res.json()) as { Code?: string; Message?: string; RequestId?: string };
    if (data.Code !== "OK") {
      // 不打印手机号全号与验证码
      throw new Error(`阿里云短信发送失败：${data.Code ?? res.status} ${data.Message ?? ""}`.trim());
    }
    console.info(`[AliyunSms] sent requestId=${data.RequestId ?? "-"}`);
  }
}
