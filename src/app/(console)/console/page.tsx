import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/infrastructure/prisma/client";

export default async function ConsolePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { phone: true, nickname: true, roles: true, kycStatus: true, reputationScore: true },
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-bold">用户控制台</h1>
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-6">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <dt className="text-slate-500">手机号</dt>
          <dd>{user?.phone ?? "—"}</dd>
          <dt className="text-slate-500">昵称</dt>
          <dd>{user?.nickname ?? "未设置"}</dd>
          <dt className="text-slate-500">角色</dt>
          <dd>{user?.roles.join("、")}</dd>
          <dt className="text-slate-500">实名状态</dt>
          <dd>{user?.kycStatus}</dd>
          <dt className="text-slate-500">信誉分</dt>
          <dd>{user?.reputationScore}</dd>
        </dl>
      </div>
      <div className="mt-6 flex gap-3">
        <Link
          href="/console/kyc"
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
        >
          {user?.kycStatus === "VERIFIED" ? "已实名认证" : "去实名认证"}
        </Link>
        <Link
          href="/console/profile"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:border-slate-900"
        >
          角色与信誉
        </Link>
        <Link
          href="/console/needs/new"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:border-slate-900"
        >
          发布需求
        </Link>
        <Link
          href="/console/needs"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:border-slate-900"
        >
          我的需求
        </Link>
        <Link
          href="/console/pledges"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:border-slate-900"
        >
          我的承诺
        </Link>
        <Link
          href="/console/proposals"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:border-slate-900"
        >
          我的提案
        </Link>
        <Link
          href="/needs"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:border-slate-900"
        >
          需求广场
        </Link>
      </div>
      <p className="mt-6 text-sm text-slate-500">
        下一步开放：付费承诺（F09）、开发者提案（F12）、里程碑交付（F14）。
      </p>
    </main>
  );
}
