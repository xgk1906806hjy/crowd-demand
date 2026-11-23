"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  needId: string;
  proposalId: string;
  builderName: string;
}

/** 发起者选定提案（F13）。 */
export function SelectProposalButton({ needId, proposalId, builderName }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function select() {
    if (!window.confirm(`确认选择「${builderName}」的方案？其余提案将被自动驳回，此操作不可撤销。`)) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/needs/${needId}/select-proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "选标失败");
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
        onClick={() => void select()}
        className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {busy ? "处理中…" : "选定此方案"}
      </button>
      {message && <span className="text-xs text-rose-600">{message}</span>}
    </div>
  );
}
