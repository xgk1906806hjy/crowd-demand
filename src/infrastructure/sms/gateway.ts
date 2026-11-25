/**
 * 短信适配器接口 —— 业务代码只依赖此接口，不直接调用具体 SDK。
 * 技术规则见 AGENTS.md 第 2 节第 4 条。
 */
import { assertMockAdapterAllowed } from "@/lib/env";
import { AliyunSmsGateway } from "@/infrastructure/sms/aliyun";
import { TencentSmsGateway } from "@/infrastructure/sms/tencent";
export interface SmsGateway {
  sendCode(params: { phone: string; code: string; purpose: string }): Promise<void>;
}

/** 开发环境/MVP 用：不真实发送，把验证码打印到日志，便于本地联调。 */
export class MockSmsGateway implements SmsGateway {
  async sendCode({ phone, code, purpose }: { phone: string; code: string; purpose: string }) {
    // 生产环境默认禁止；仅 APP_ENV=demo 的内部演示实例放行（并打印告警）
    assertMockAdapterAllowed("短信");
    console.info(`[MockSMS] to=${phone} purpose=${purpose} code=${code}`);
  }
}

/** 工厂：根据环境变量选择实现。aliyun/tencent 为零 SDK 依赖的签名 HTTP 实现。 */
export function createSmsGateway(adapter = process.env.SMS_ADAPTER): SmsGateway {
  switch (adapter) {
    case "mock":
    case undefined:
      return new MockSmsGateway();
    case "aliyun":
      return new AliyunSmsGateway();
    case "tencent":
      return new TencentSmsGateway();
    default:
      throw new Error(`未实现的短信适配器: ${adapter}`);
  }
}
