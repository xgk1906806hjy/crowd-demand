"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Reputation = {
  score: number;
  completedProjects: number;
  totalProjects: number;
  refundedProjects: number;
  refundRate: number;
};

const ROLE_TEXT: Record<string, string> = {
  REQUESTER: "需求发起者",
  BACKER: "支持者",
  BUILDER: "开发者",
  OPERATOR: "运营方",
};

export default function ProfilePage() {
  const [roles, setRoles] = useState<string[]>([]);
  const [reputation, setReputation] = useState<Reputation | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [meRes, repRes] = await Promise.all([
      fetch("/api/auth/me"),
      fetch("/api/reputation/me"),
    ]);
    if (meRes.ok) {
      const me = await meRes.json();
      setRoles(me.data.roles as string[]);
    }
    if (repRes.ok) {
      const rep = await repRes.json();
      setReputation(rep.data as Reputation);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function apply(role: string) {
    setMessage("");
    setBusy(true);
    try {
      const res = await fetch("/api/roles/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "申请失败");
      } else {
        setRoles(data.data.roles as string[]);
        setMessage("申请成功");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <Link href="/console" className="text-sm text-slate-500 hover:underline">
        ← 返回控制台
      </Link>
      <h1 className="mt-4 text-2xl font-bold">角色与信誉</h1>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium text-slate-500">我的角色</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {roles.map((r) => (
            <span key={r} className="rounded-full bg-slate-100 px-3 py-1 text-sm">
              {ROLE_TEXT[r] ?? r}
            </span>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          {!roles.includes("REQUESTER") && (
            <button
              onClick={() => apply("REQUESTER")}
              disabled={busy}
              className="rounded-lg border border-slate-900 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              申请成为需求发起者
            </button>
          )}
          {!roles.includes("BUILDER") && (
            <button
              onClick={() => apply("BUILDER")}
              disabled={busy}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              申请成为开发者（需实名）
            </button>
          )}
        </div>
        {message && <p className="mt-3 text-sm text-amber-600">{message}</p>}
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-medium text-slate-500">信誉分</h2>
        {reputation ? (
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">当前分值</span>
              <span className="text-lg font-semibold">{reputation.score}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">履约项目</span>
              <span>{reputation.completedProjects} / {reputation.totalProjects}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">退款率</span>
              <span>{Math.round(reputation.refundRate * 100)}%</span>
            </div>
            <p className="pt-2 text-xs text-slate-400">
              基础分 60，每完成一个项目 +8，每发生一次退款 −10，区间 0–100。
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-slate-400">加载中…</p>
        )}
      </section>
    </main>
  );
}
