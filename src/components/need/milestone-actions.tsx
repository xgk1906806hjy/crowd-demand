"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "submit" | "accept";
type Panel = "none" | "submit" | "reject";

/** 里程碑操作（F14/F15）：提交交付物 / 验收通过放款 / 驳回。 */
export function MilestoneActions({ milestoneId, mode }: { milestoneId: string; mode: Mode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>("none");
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");

  async function post(kind: "submit" | "accept" | "reject") {
    if (
      kind === "accept" &&
      !window.confirm("确认验收通过？通过后将立即从托管账户向开发者放款，不可撤销。")
    ) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/milestones/${milestoneId}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "submit" ? { note: text } : kind === "reject" ? { reason: text } : {},
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "操作失败");
        return;
      }
      setPanel("none");
      setText("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {mode === "submit" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setPanel(panel === "submit" ? "none" : "submit")}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:border-slate-900 disabled:opacity-50"
          >
            提交交付物
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void post("accept")}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              验收通过并放款
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setPanel(panel === "reject" ? "none" : "reject")}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:border-rose-400 hover:text-rose-600 disabled:opacity-50"
            >
              驳回
            </button>
          </>
        )}
      </div>

      {panel !== "none" && (
        <div className="mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={
              panel === "submit" ? "交付说明（可选）：链接、功能范围" : "驳回原因（至少 5 字）"
            }
            className="w-full rounded border border-slate-300 px-2 py-1 text-xs outline-none"
          />
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={() => setPanel("none")} className="text-xs text-slate-400">
              取消
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void post(panel)}
              className="rounded bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-50"
            >
              确认
            </button>
          </div>
        </div>
      )}

      {message && <span className="text-xs text-rose-600">{message}</span>}
    </div>
  );
}
