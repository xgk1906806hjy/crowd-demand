"use client";

import { useState } from "react";

/** 举报入口（F20）：简化交互，使用浏览器输入框收集原因。 */
export function ReportButton({ targetId, targetType = "NEED" }: { targetId: string; targetType?: "NEED" | "PROPOSAL" | "USER" }) {
  const [message, setMessage] = useState("");

  async function report() {
    const reason = window.prompt("请说明举报原因（至少 10 个字）");
    if (!reason) return;
    setMessage("");
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType, targetId, reason }),
    });
    const data = await res.json();
    setMessage(res.ok ? "举报已提交，运营方将尽快处理" : (data.error ?? "提交失败"));
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={() => void report()} className="text-xs text-slate-400 hover:text-rose-600">
        举报
      </button>
      {message && <span className="text-xs text-slate-500">{message}</span>}
    </span>
  );
}
