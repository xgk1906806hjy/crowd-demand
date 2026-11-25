"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Tab = "code" | "password" | "register";
type Channel = "phone" | "email";

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("code");
  const [channel, setChannel] = useState<Channel>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

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

  function switchTab(next: Tab) {
    setTab(next);
    setMessage("");
  }

  function switchChannel(next: Channel) {
    setChannel(next);
    setMessage("");
    setCode("");
  }

  async function sendCode() {
    setMessage("");
    setSending(true);
    try {
      const body = channel === "phone" ? { phone } : { email };
      const res = await fetch("/api/auth/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "发送失败");
      } else {
        setMessage(
          channel === "phone"
            ? "验证码已发送，5 分钟内有效"
            : "验证码已发送到邮箱，5 分钟内有效",
        );
        startCountdown();
      }
    } finally {
      setSending(false);
    }
  }

  async function loginWithCode(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      const body = channel === "phone" ? { phone, code } : { email, code };
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  async function loginWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, password }),
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

  async function register(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");
    if (regPassword !== regConfirm) {
      setMessage("两次输入的密码不一致");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: regUsername, password: regPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "注册失败");
      } else {
        router.push("/console");
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  const field =
    "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-900";
  const tabBtn = (active: boolean) =>
    `flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
      active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
    }`;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-bold">登录需求平台</h1>
      <p className="mt-2 text-sm text-slate-500">用户名可直接注册；也可用手机号/邮箱验证码登录</p>

      <div className="mt-6 flex gap-1 rounded-xl bg-slate-50 p-1 ring-1 ring-slate-200">
        <button type="button" className={tabBtn(tab === "code")} onClick={() => switchTab("code")}>
          验证码登录
        </button>
        <button
          type="button"
          className={tabBtn(tab === "password")}
          onClick={() => switchTab("password")}
        >
          密码登录
        </button>
        <button
          type="button"
          className={tabBtn(tab === "register")}
          onClick={() => switchTab("register")}
        >
          注册
        </button>
      </div>

      {tab === "code" ? (
        <form onSubmit={loginWithCode} className="mt-6 space-y-4">
          <div className="flex gap-3 text-sm">
            <button
              type="button"
              onClick={() => switchChannel("phone")}
              className={
                channel === "phone"
                  ? "font-medium text-slate-900 underline underline-offset-4"
                  : "text-slate-500 hover:text-slate-900"
              }
            >
              手机号
            </button>
            <button
              type="button"
              onClick={() => switchChannel("email")}
              className={
                channel === "email"
                  ? "font-medium text-slate-900 underline underline-offset-4"
                  : "text-slate-500 hover:text-slate-900"
              }
            >
              邮箱
            </button>
          </div>

          {channel === "phone" ? (
            <div>
              <label className="block text-sm font-medium">手机号</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="13800138000"
                inputMode="tel"
                className={field}
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium">邮箱</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                inputMode="email"
                className={field}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium">验证码</label>
            <div className="mt-1 flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="6 位数字"
                maxLength={6}
                inputMode="numeric"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
              />
              <button
                type="button"
                onClick={sendCode}
                disabled={sending || countdown > 0}
                className="whitespace-nowrap rounded-lg border border-slate-900 px-3 py-2 text-sm disabled:opacity-50"
              >
                {countdown > 0 ? `${countdown}s 后重发` : sending ? "发送中" : "获取验证码"}
              </button>
            </div>
          </div>

          {message && <p className="text-sm text-amber-600">{message}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-white disabled:opacity-50"
          >
            {loading ? "登录中" : "登录 / 注册"}
          </button>
        </form>
      ) : tab === "password" ? (
        <form onSubmit={loginWithPassword} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium">用户名 / 手机号 / 邮箱</label>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="my_name、13800138000 或 you@example.com"
              className={field}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="8 位，数字开头，含大小写字母和特殊符号"
              className={field}
            />
          </div>
          {message && <p className="text-sm text-amber-600">{message}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-white disabled:opacity-50"
          >
            {loading ? "登录中" : "登录"}
          </button>
          <p className="text-xs text-slate-400">
            还没有账号？切到「注册」用用户名直接注册。手机号/邮箱账号忘记密码时，可用验证码登录后到「个人中心 → 安全设置」重新设置。
          </p>
        </form>
      ) : (
        <form onSubmit={register} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium">用户名</label>
            <input
              value={regUsername}
              onChange={(e) => setRegUsername(e.target.value)}
              placeholder="4-20 位，字母开头，可含数字和下划线"
              autoComplete="username"
              className={field}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">密码</label>
            <input
              type="password"
              value={regPassword}
              onChange={(e) => setRegPassword(e.target.value)}
              placeholder="8 位，数字开头，含大小写字母和特殊符号"
              autoComplete="new-password"
              className={field}
            />
          </div>
          <div>
            <label className="block text-sm font-medium">确认密码</label>
            <input
              type="password"
              value={regConfirm}
              onChange={(e) => setRegConfirm(e.target.value)}
              placeholder="再输入一次密码"
              autoComplete="new-password"
              className={field}
            />
          </div>
          {message && <p className="text-sm text-amber-600">{message}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-white disabled:opacity-50"
          >
            {loading ? "注册中" : "注册并登录"}
          </button>
          <p className="text-xs text-slate-400">
            注册无需手机号或邮箱。涉及资金的操作需先完成实名认证；手机号/邮箱可之后在「个人中心 → 安全设置」补充绑定。
          </p>
        </form>
      )}

      {process.env.NODE_ENV !== "production" && (
        <p className="mt-6 text-xs text-slate-400">
          开发环境：验证码打印在服务端控制台（Mock 短信/邮件）。
        </p>
      )}
    </main>
  );
}
