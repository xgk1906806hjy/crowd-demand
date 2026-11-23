/**
 * 实名核验适配器接口 —— 业务代码只依赖此接口。
 * 生产接入持牌/权威核验服务；MVP 用 Mock。
 */
export interface KycVerifyParams {
  realName: string;
  idNumber: string;
}

export interface KycVerifyResult {
  passed: boolean;
  reason?: string;
  providerRef?: string;
}

export interface KycGateway {
  verify(params: KycVerifyParams): Promise<KycVerifyResult>;
}

/** 开发/测试用：姓名含「拒绝」则模拟核验失败，便于覆盖失败分支。 */
export class MockKycGateway implements KycGateway {
  async verify({ realName }: KycVerifyParams): Promise<KycVerifyResult> {
    if (process.env.NODE_ENV === "production") {
      throw new Error("合规红线：生产环境禁止使用 mock 实名适配器");
    }
    if (realName.includes("拒绝")) {
      return { passed: false, reason: "身份信息与权威库不匹配（模拟）" };
    }
    return { passed: true, providerRef: `mock-kyc-${Date.now()}` };
  }
}

export function createKycGateway(adapter = process.env.KYC_ADAPTER): KycGateway {
  switch (adapter) {
    case "mock":
    case undefined:
      return new MockKycGateway();
    default:
      throw new Error(`未实现的实名适配器: ${adapter}`);
  }
}
