"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { centsToYuan } from "@/lib/money";

interface Props {
  needId: string;
  loggedIn: boolean;
  kycVerified: boolean;
  targetAmount: string;
  pledgedAmount: string;
}

/** 付费承诺表单（F09）：预设档位 + 自定义金额，提交后刷新进度。 */
export function PledgeForm({
  needId,
  loggedIn,
  kycVerified,
  targetAmount,
  pledgedAmount,
}: Props) {
  const router = useRouter();
  const [amount, setAmount] = useState("49");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (!loggedIn) {
    return (
      <Link
        href="/login"
        className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
      >
        登录后预付订金
      </Link>
    );
  }

  if (!kycVerified) {
    return (
      <Link
        href="/console/kyc"
        className="inline-flex rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 hover:bg-amber-100"
      >
        实名后可预付订金
      </Link>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/needs/${needId}/pledges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountYuan: amount,
          // 幂等键：同一次点击重复提交不会重复扣款
          idempotencyKey: `pledge:${needId}:${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "承诺失败");
        return;
      }
      setMessage(
        data.data.funded
          ? "承诺成功，该需求已达到目标金额，资金已锁定并进入竞标"
          : `承诺成功，当前进度 ${data.data.progress}%`,
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
      <div className="text-sm font-medium text-slate-800">预付订金，支持这个需求</div>
      <p className="mt-1 text-xs text-slate-500">
        资金进入持牌机构托管账户；未达目标金额将全额原路退回。
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {["9.9", "49", "99", "199"].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setAmount(preset)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              amount === preset
                ? "border-emerald-600 bg-white text-emerald-700"
                : "border-slate-300 bg-white text-slate-600 hover:border-slate-500"
            }`}
          >
            ¥{preset}
          </button>
        ))}
        <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2">
          <span className="text-sm text-slate-400">¥</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="w-20 py-1.5 text-sm outline-none"
            aria-label="自定义承诺金额"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? "处理中…" : `预付 ¥${amount || "0"}`}
        </button>
        <span className="text-xs text-slate-500">
          已承诺 ¥{centsToYuan(BigInt(pledgedAmount))} / 目标 ¥{centsToYuan(BigInt(targetAmount))}
        </span>
      </div>

      {message && <p className="mt-2 text-sm text-emerald-700">{message}</p>}
    </form>
  );
}
