import { env } from "@/lib/env";

/**
 * 支付/托管适配器 —— 领域层只依赖本接口，不感知具体持牌机构。
 * MVP 使用 Mock；生产必须接持牌机构，且 `PAYMENT_ADAPTER=licensed`。
 */
export interface PaymentGateway {
  readonly provider: string;
  /** 冻结：把支持者的钱划入托管账户。 */
  freeze(input: { amount: bigint; reference: string }): Promise<{ ref: string }>;
  /** 放款：从托管账户划给开发者。 */
  release(input: { amount: bigint; reference: string }): Promise<{ ref: string }>;
  /** 退款：从托管账户原路退回支持者。 */
  refund(input: { amount: bigint; reference: string }): Promise<{ ref: string }>;
}

let seq = 0;

export class MockPaymentGateway implements PaymentGateway {
  readonly provider = "mock";

  async freeze(input: { amount: bigint; reference: string }) {
    seq += 1;
    return { ref: `mock-freeze-${Date.now()}-${seq}-${input.reference.slice(0, 8)}` };
  }

  async release(input: { amount: bigint; reference: string }) {
    seq += 1;
    return { ref: `mock-release-${Date.now()}-${seq}-${input.reference.slice(0, 8)}` };
  }

  async refund(input: { amount: bigint; reference: string }) {
    seq += 1;
    return { ref: `mock-refund-${Date.now()}-${seq}-${input.reference.slice(0, 8)}` };
  }
}

/** 按环境变量选择适配器。生产环境禁止 Mock（合规红线）。 */
export function createPaymentGateway(): PaymentGateway {
  if (env.PAYMENT_ADAPTER === "mock") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("合规红线：生产环境禁止使用 Mock 支付适配器，请接入持牌机构");
    }
    return new MockPaymentGateway();
  }
  // licensed 适配器在接入持牌机构后实现（F10 后续）
  throw new Error("licensed 支付适配器尚未接入，请联系运营方配置");
}
