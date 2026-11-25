/**
 * 邮件适配器接口 —— 业务代码只依赖此接口，不直接调用具体 SDK。
 * 技术规则见 AGENTS.md 第 2 节第 4 条。
 */
import { assertMockAdapterAllowed, env } from "@/lib/env";
import { smtpSendMail, type SmtpOptions } from "@/infrastructure/email/smtp";

export interface EmailGateway {
  sendCode(params: { email: string; code: string; purpose: string }): Promise<void>;
}

/** 开发环境/MVP 用：不真实发送，把验证码打印到日志，便于本地联调。 */
export class MockEmailGateway implements EmailGateway {
  async sendCode({ email, code, purpose }: { email: string; code: string; purpose: string }) {
    // 生产环境默认禁止；仅 APP_ENV=demo 的内部演示实例放行（并打印告警）
    assertMockAdapterAllowed("邮件");
    console.info(`[MockEmail] to=${email} purpose=${purpose} code=${code}`);
  }
}

type SmtpConfig = SmtpOptions & { from: string };

function smtpConfigFromEnv(): SmtpConfig {
  const cfg = {
    host: env.SMTP_HOST ?? "",
    port: Number(env.SMTP_PORT),
    secure: env.SMTP_SECURE === "true",
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM || env.SMTP_USER || "",
  };
  const missing: string[] = [];
  if (!cfg.host) missing.push("SMTP_HOST");
  if (!cfg.user) missing.push("SMTP_USER");
  if (!cfg.pass) missing.push("SMTP_PASS");
  if (!Number.isInteger(cfg.port) || cfg.port <= 0) missing.push("SMTP_PORT");
  if (missing.length) {
    throw new Error(`EMAIL_ADAPTER=smtp 但缺少配置：${missing.join(", ")}`);
  }
  return cfg;
}

/**
 * 真实 SMTP 发信（QQ/163/Gmail/企业邮箱均可）。
 * 配置：SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / SMTP_FROM。
 * 注意：QQ/163 的 SMTP_PASS 是「授权码」，不是邮箱登录密码。
 */
export class SmtpEmailGateway implements EmailGateway {
  constructor(private readonly cfg: SmtpConfig = smtpConfigFromEnv()) {}

  async sendCode({ email, code, purpose }: { email: string; code: string; purpose: string }) {
    const action = purpose === "BIND" ? "绑定邮箱" : "登录";
    await smtpSendMail(this.cfg, {
      from: this.cfg.from,
      to: email,
      subject: `【需求平台】${action}验证码`,
      text: `你正在进行「${action}」操作，验证码为 ${code}，5 分钟内有效。\n\n如果不是你本人操作，请忽略本邮件。验证码请勿泄露给任何人。`,
    });
    // 真实通道不打印验证码，只记录投递事实
    console.info(`[SmtpEmail] to=${email} purpose=${purpose} sent`);
  }
}

/** 工厂：根据环境变量选择实现。 */
export function createEmailGateway(adapter = process.env.EMAIL_ADAPTER): EmailGateway {
  switch (adapter) {
    case "mock":
    case undefined:
      return new MockEmailGateway();
    case "smtp":
      return new SmtpEmailGateway();
    default:
      throw new Error(`未实现的邮件适配器: ${adapter}`);
  }
}
