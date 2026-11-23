"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** 举报处理按钮（F20）。 */
export function ReportHandleButtons({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function handle(action: "RESOLVE" | "REJECT") {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/reports/${reportId}/handle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "处理失败");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void handle("RESOLVE")}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
        >
          举报成立
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handle("REJECT")}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:border-slate-900 disabled:opacity-50"
        >
          不成立
        </button>
      </div>
      {message && <span className="text-xs text-rose-600">{message}</span>}
    </div>
  );
}
