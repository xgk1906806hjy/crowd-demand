"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function sendCode() {
    setMessage("");
    setSending(true);
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "发送失败");
      } else {
        setMessage("验证码已发送，5 分钟内有效");
      }
    } finally {
      setSending(false);
    }
  }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "登录失败");
      } else {
        router.push("/console");
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-bold">手机号登录</h1>
      <p className="mt-2 text-sm text-slate-500">首次登录将自动注册账号</p>

      <form onSubmit={login} className="mt-8 space-y-4">
        <div>
          <label className="block text-sm font-medium">手机号</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="13800138000"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
          />
        </div>
        <div>
          <label className="block text-sm font-medium">验证码</label>
          <div className="mt-1 flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="6 位数字"
              maxLength={6}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
            />
            <button
              type="button"
              onClick={sendCode}
              disabled={sending}
              className="whitespace-nowrap rounded-lg border border-slate-900 px-3 py-2 text-sm disabled:opacity-50"
            >
              {sending ? "发送中" : "获取验证码"}
            </button>
          </div>
        </div>
        {message && <p className="text-sm text-amber-600">{message}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-white disabled:opacity-50"
        >
          {loading ? "登录中" : "登录"}
        </button>
      </form>

      {process.env.NODE_ENV !== "production" && (
        <p className="mt-6 text-xs text-slate-400">
          开发环境：验证码打印在服务端控制台（Mock 短信）。
        </p>
      )}
    </main>
  );
}
