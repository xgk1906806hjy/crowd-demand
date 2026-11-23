/**
 * 应用启动钩子：把「生产环境禁用 Mock 支付适配器」的合规红线接线到真实启动流程。
 * 仅在 Node 运行时执行（Edge 运行时没有完整环境变量与支付适配器依赖）。
 */
export async function register() {
  // 只跳过 Edge 运行时；standalone 下 NEXT_RUNTIME 可能为空，不能因此静默跳过合规校验
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { assertProductionPaymentSafe } = await import("@/lib/env");
  assertProductionPaymentSafe();
}
