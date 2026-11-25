"use client";

import { useState } from "react";
import { SecuritySettings } from "@/components/auth/security-settings";

export const ROLE_TEXT: Record<string, string> = {
  REQUESTER: "需求发起者",
  BACKER: "支持者",
  BUILDER: "开发者",
  OPERATOR: "运营方",
};

/** 角色面板：申请角色 + 账号安全设置。信誉分在概览卡展示。 */
export function RolePanel({ initialRoles }: { initialRoles: string[] }) {
  const [roles, setRoles] = useState<string[]>(initialRoles);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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
    <div className="space-y-4">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
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
              onClick={() => void apply("REQUESTER")}
              disabled={busy}
              className="rounded-lg border border-slate-900 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              申请成为需求发起者
            </button>
          )}
          {!roles.includes("BUILDER") && (
            <button
              onClick={() => void apply("BUILDER")}
              disabled={busy}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              申请成为开发者
            </button>
          )}
        </div>
        {message && <p className="mt-3 text-sm text-amber-600">{message}</p>}
        <p className="mt-3 text-xs text-slate-400">
          角色只影响展示与筛选；投票与领取需求不再限制角色，涉及资金的需求仍需实名。
        </p>
      </section>
      <SecuritySettings />
    </div>
  );
}
