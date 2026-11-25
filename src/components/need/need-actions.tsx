"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  needId: string;
  status: "DRAFT" | "COLLECTING";
  /** 需求模式：非众筹草稿发布后直接进入方案征集，而不是承诺期 */
  mode?: "CROWDFUND" | "BOUNTY" | "OPEN";
}

/** 发起者操作（F06 / F28）：草稿发布、征集撤销。 */
export function NeedActions({ needId, status, mode = "CROWDFUND" }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function transition(to: "COLLECTING" | "BIDDING" | "FAILED", reason: string) {
    if (to === "FAILED" && !window.confirm("确认撤销该需求？撤销后不可恢复。")) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/needs/${needId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "操作失败");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        {status === "DRAFT" && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void transition(
                mode === "CROWDFUND" ? "COLLECTING" : "BIDDING",
                "发起者发布草稿",
              )
            }
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
          >
            发布需求
          </button>
        )}
        {status === "COLLECTING" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void transition("FAILED", "发起者主动撤销")}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-rose-400 hover:text-rose-600 disabled:opacity-50"
          >
            撤销需求
          </button>
        )}
      </div>
      {message && <span className="text-xs text-rose-600">{message}</span>}
    </div>
  );
}
