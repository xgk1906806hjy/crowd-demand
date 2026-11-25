"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface MeInfo {
  phone: string | null;
  email: string | null;
  username: string | null;
  hasPassword: boolean;
}

/** 安全设置（F31/F32）：账号信息 + 绑定邮箱 + 设置/修改密码。 */
export function SecuritySettings() {
  const [me, setMe] = useState<MeInfo | null>(null);
  const [email, setEmail] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/auth/me");
    if (res.ok) {
      const data = await res.json();
      setMe({
        phone: data.data.phone as string | null,
        email: data.data.email as string | null,
        username: data.data.username as string | null,
        hasPassword: Boolean(data.data.hasPassword),
      });
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  function startCountdown() {
    setCountdown(60);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1 && timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function sendBindCode() {
    setMessage("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, purpose: "BIND" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "发送失败");
      } else {
        setMessage("绑定验证码已发送到邮箱，5 分钟内有效");
        startCountdown();
      }
    } finally {
      setBusy(false);
    }
  }

  async function bindEmail() {
    setMessage("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/email/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: emailCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "绑定失败");
      } else {
        setMessage("邮箱绑定成功");
        setEmailCode("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    setMessage("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          currentPassword: me?.hasPassword ? currentPassword : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "设置失败");
      } else {
        setMessage(me?.hasPassword ? "密码已修改" : "密码已设置，下次可用密码登录");
        setPassword("");
        setCurrentPassword("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  const field =
    "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900";

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-medium text-slate-500">安全设置</h2>
      {!me ? (
        <p className="mt-2 text-sm text-slate-400">加载中…</p>
      ) : (
        <div className="mt-3 space-y-5">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">用户名</span>
              <span>{me.username ?? "未设置"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">手机号</span>
              <span>{me.phone ?? "未绑定"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">邮箱</span>
              <span>{me.email ?? "未绑定"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">登录密码</span>
              <span>{me.hasPassword ? "已设置" : "未设置"}</span>
            </div>
          </div>

          {!me.email && (
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-600">绑定邮箱</div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                inputMode="email"
                className={field}
              />
              <div className="mt-2 flex gap-2">
                <input
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value)}
                  placeholder="6 位验证码"
                  maxLength={6}
                  inputMode="numeric"
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
                />
                <button
                  type="button"
                  onClick={() => void sendBindCode()}
                  disabled={busy || countdown > 0}
                  className="whitespace-nowrap rounded-lg border border-slate-900 px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  {countdown > 0 ? `${countdown}s` : "发送验证码"}
                </button>
                <button
                  type="button"
                  onClick={() => void bindEmail()}
                  disabled={busy}
                  className="whitespace-nowrap rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                >
                  绑定
                </button>
              </div>
            </div>
          )}

          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs font-medium text-slate-600">
              {me.hasPassword ? "修改密码" : "设置登录密码"}
            </div>
            {me.hasPassword && (
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="当前密码"
                className={field}
              />
            )}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="新密码：8 位，数字开头，含大小写字母和特殊符号"
              className={field}
            />
            <button
              type="button"
              onClick={() => void savePassword()}
              disabled={busy}
              className="mt-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              {me.hasPassword ? "修改密码" : "设置密码"}
            </button>
            <p className="mt-2 text-xs text-slate-400">
              设置后可在登录页用「手机号或邮箱 + 密码」登录；忘记密码时用验证码登录后重新设置。
            </p>
          </div>

          {message && <p className="text-sm text-amber-600">{message}</p>}
        </div>
      )}
    </section>
  );
}
