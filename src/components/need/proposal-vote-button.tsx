"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  needId: string;
  proposalId: string;
  /** 当前用户已投的提案（null 表示未投） */
  votedProposalId: string | null;
  /** 当前用户是否对该需求有有效承诺 */
  canVote: boolean;
}

/** 支持者用承诺选票为提案投票（F13）：一人一票，可改票。 */
export function ProposalVoteButton({ needId, proposalId, votedProposalId, canVote }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const votedThis = votedProposalId === proposalId;
  const label = votedThis ? "已支持此方案" : votedProposalId ? "改投此方案" : "用订金支持此方案";

  async function vote() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/needs/${needId}/proposal-vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "投票失败");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!canVote) {
    return <span className="text-xs text-slate-400">付过订金的支持者可投票</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy || votedThis}
        onClick={() => void vote()}
        className={`rounded-lg px-3 py-1.5 text-xs disabled:opacity-60 ${
          votedThis
            ? "border border-emerald-500 text-emerald-700"
            : "border border-slate-300 text-slate-700 hover:border-slate-900 hover:text-slate-900"
        }`}
      >
        {busy ? "处理中…" : label}
      </button>
      {message && <span className="text-xs text-rose-600">{message}</span>}
    </div>
  );
}
