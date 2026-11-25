"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type StatusView = {
  kycStatus: "NONE" | "PENDING" | "VERIFIED" | "REJECTED";
  realNameMasked: string | null;
  verifiedAt: string | null;
  reason: string | null;
};

const STATUS_TEXT: Record<StatusView["kycStatus"], string> = {
  NONE: "未认证",
  PENDING: "审核中",
  VERIFIED: "已认证",
  REJECTED: "未通过",
};

/** 实名认证面板（F05）：控制台页内与 /console/kyc 共用。 */
export function KycPanel({ initialStatus }: { initialStatus?: StatusView["kycStatus"] }) {
  const router = useRouter();
  const [status, setStatus] = useState<StatusView | null>(
    initialStatus
      ? { kycStatus: initialStatus, realNameMasked: null, verifiedAt: null, reason: null }
      : null,
  );
  const [realName, setRealName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/kyc/status");
    const data = await res.json();
    if (res.ok) setStatus(data.data as StatusView);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      const res = await fetch("/api/kyc/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ realName, idNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "提交失败");
      } else {
        setMessage("认证成功");
        await load();
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  const verified = status?.kycStatus === "VERIFIED";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">
        涉及资金的操作需要先完成实名认证。身份证号仅以加密哈希保存，不会明文存储。
      </p>

      {status && (
        <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">当前状态</span>
            <span className={verified ? "font-medium text-emerald-600" : "font-medium text-amber-600"}>
              {STATUS_TEXT[status.kycStatus]}
            </span>
          </div>
          {status.realNameMasked && (
            <div className="mt-2 flex justify-between">
              <span className="text-slate-500">实名信息</span>
              <span>{status.realNameMasked}</span>
            </div>
          )}
          {status.reason && (
            <div className="mt-2 flex justify-between">
              <span className="text-slate-500">失败原因</span>
              <span className="text-rose-600">{status.reason}</span>
            </div>
          )}
        </div>
      )}

      {!verified && (
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium">真实姓名</label>
            <input
              value={realName}
              onChange={(e) => setRealName(e.target.value)}
              placeholder="请输入真实姓名"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">身份证号</label>
            <input
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              placeholder="18 位身份证号"
              maxLength={18}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
            />
          </div>
          {message && <p className="text-sm text-amber-600">{message}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-white disabled:opacity-50"
          >
            {loading ? "提交中" : "提交认证"}
          </button>
        </form>
      )}

      {verified && (
        <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          已完成实名认证，可以发布需求、做出付费承诺与领取涉及资金的需求。
        </p>
      )}
    </section>
  );
}
