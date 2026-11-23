"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Props {
  needId: string;
  initialCount: number;
  initialVoted: boolean;
  loggedIn: boolean;
  kycVerified: boolean;
  votable: boolean;
}

/** 投票按钮（F07）：未登录引导登录，未实名引导实名，已投可撤回。 */
export function VoteButton({
  needId,
  initialCount,
  initialVoted,
  loggedIn,
  kycVerified,
  votable,
}: Props) {
  const router = useRouter();
  const [count, setCount] = useState(initialCount);
  const [voted, setVoted] = useState(initialVoted);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(action: "UP" | "CANCEL") {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/needs/${needId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "操作失败");
        return;
      }
      setCount(data.data.voteCount as number);
      setVoted(data.data.voted as boolean);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!loggedIn) {
    return (
      <Link
        href="/login"
        className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
      >
        登录后投票
      </Link>
    );
  }

  if (!kycVerified) {
    return (
      <Link
        href="/console/kyc"
        className="inline-flex rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 hover:bg-amber-100"
      >
        实名后可投票（一人一票）
      </Link>
    );
  }

  if (!votable && !voted) {
    return (
      <span className="inline-flex rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-500">
        投票已截止
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit(voted ? "CANCEL" : "UP")}
        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
          voted
            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-300"
            : "bg-slate-900 text-white hover:bg-slate-700"
        }`}
      >
        <span>{voted ? "已支持" : "支持这个需求"}</span>
        <span className="rounded bg-white/20 px-1.5 text-xs">{count}</span>
      </button>
      {voted && votable && (
        <span className="text-xs text-slate-400">再次点击可撤回</span>
      )}
      {message && <span className="text-xs text-rose-600">{message}</span>}
    </div>
  );
}
