"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RolePanel } from "@/components/console/role-panel";

type Reputation = {
  score: number;
  completedProjects: number;
  totalProjects: number;
  refundedProjects: number;
  refundRate: number;
};

export default function ProfilePage() {
  const [roles, setRoles] = useState<string[]>([]);
  const [reputation, setReputation] = useState<Reputation | null>(null);

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

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <Link href="/console" className="text-sm text-slate-500 hover:underline">
        ← 返回控制台
      </Link>
      <h1 className="mt-4 text-2xl font-bold">角色与信誉</h1>

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
              <span>
                {reputation.completedProjects} / {reputation.totalProjects}
              </span>
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

      <div className="mt-4">
        <RolePanel initialRoles={roles} />
      </div>
    </main>
  );
}
