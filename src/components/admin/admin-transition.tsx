"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = [
  "DRAFT",
  "COLLECTING",
  "PLEDGING",
  "BIDDING",
  "IN_PROGRESS",
  "ACCEPTING",
  "COMPLETED",
  "FAILED",
  "REFUNDED",
] as const;

const LABELS: Record<string, string> = {
  DRAFT: "草稿",
  COLLECTING: "征集中",
  PLEDGING: "承诺中",
  BIDDING: "竞标中",
  IN_PROGRESS: "开发中",
  ACCEPTING: "验收中",
  COMPLETED: "已完成",
  FAILED: "已流拍",
  REFUNDED: "已退款",
};

/** 运营强制流转（F18）：仅状态机允许的流转会成功。 */
export function AdminTransition({ needId, current }: { needId: string; current: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function change(to: string) {
    if (!to) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/needs/${needId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, reason: "运营后台调整" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "流转失败");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={current}
        disabled={busy}
        onChange={(e) => void change(e.target.value)}
        className="rounded border border-slate-300 px-2 py-1 text-xs"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {LABELS[s] ?? s}
          </option>
        ))}
      </select>
      {message && <span className="text-xs text-rose-600">{message}</span>}
    </div>
  );
}
