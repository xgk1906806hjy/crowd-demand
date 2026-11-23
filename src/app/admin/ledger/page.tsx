import { LedgerQueryService, type LedgerOverview } from "@/domain/ledger/query";
import { displayMoney, displayDateTime } from "@/lib/display";

export const dynamic = "force-dynamic";

const ACCOUNT_LABEL: Record<string, string> = {
  BACKER: "支持者",
  ESCROW: "托管",
  BUILDER: "开发者",
};

export default async function AdminLedgerPage() {
  let data: LedgerOverview | null = null;
  let dbError = false;
  try {
    const res = await new LedgerQueryService().overview(100);
    if (res.ok) data = res.value;
  } catch {
    dbError = true;
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">资金流水与托管状态</h2>
      <p className="mt-1 text-sm text-slate-500">
        账本为唯一真相，余额由流水推导；金额单位为元。
      </p>

      {dbError && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          数据库未连接，无法加载流水。
        </div>
      )}

      {data && (
        <>
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {[
              { label: "托管余额", value: data.escrowBalance },
              { label: "累计承诺", value: data.totalPledged },
              { label: "累计放款", value: data.totalReleased },
              { label: "累计退款", value: data.totalRefunded },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="text-xs text-slate-500">{s.label}</div>
                <div className="mt-1 text-lg font-semibold">{displayMoney(s.value)}</div>
              </div>
            ))}
          </div>

          <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2">时间</th>
                  <th className="px-4 py-2">账户</th>
                  <th className="px-4 py-2">方向</th>
                  <th className="px-4 py-2">金额</th>
                  <th className="px-4 py-2">余额快照</th>
                  <th className="px-4 py-2">业务</th>
                  <th className="px-4 py-2">备注</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2 text-xs text-slate-500">{displayDateTime(e.createdAt)}</td>
                    <td className="px-4 py-2">
                      {ACCOUNT_LABEL[e.accountType] ?? e.accountType}
                      <span className="ml-1 text-xs text-slate-400">{e.accountId}</span>
                    </td>
                    <td className="px-4 py-2">
                      <span className={e.direction === "CREDIT" ? "text-emerald-600" : "text-rose-600"}>
                        {e.direction === "CREDIT" ? "流入" : "流出"}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-medium">{displayMoney(e.amount)}</td>
                    <td className="px-4 py-2 text-slate-500">{displayMoney(e.balanceAfter)}</td>
                    <td className="px-4 py-2 text-xs">{e.bizType}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{e.memo ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
