"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { centsToYuan } from "@/lib/money";

interface Props {
  needId: string;
  mode: "BOUNTY" | "OPEN";
  /** 悬赏金额（分），无偿模式为 "0" */
  amount: string;
}

/** 需求方撤回有偿悬赏 / 无偿收集（F28）：悬赏按托管余额原路退款。 */
export function BountyCancelButton({ needId, mode, amount }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function cancel() {
    const tip =
      mode === "BOUNTY"
        ? `确认撤回该悬赏需求？已托管的 ¥${centsToYuan(BigInt(amount))} 中未放款部分将原路退回。`
        : "确认关闭该需求？关闭后不可恢复。";
    if (!window.confirm(tip)) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/needs/${needId}/bounty-cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "撤回失败");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void cancel()}
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-rose-400 hover:text-rose-600 disabled:opacity-50"
      >
        {busy ? "撤回中…" : mode === "BOUNTY" ? "撤回并退款" : "关闭需求"}
      </button>
      {message && <span className="text-xs text-rose-600">{message}</span>}
    </div>
  );
}
