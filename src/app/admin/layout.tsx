import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { UserRole } from "@prisma/client";

/** 运营后台布局：仅 OPERATOR 可进入（以数据库最新角色为准）。 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/admin");
  if (!user.roles.includes(UserRole.OPERATOR)) redirect("/console");

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold">运营后台</h1>
          <p className="text-xs text-slate-500">审核、举报处理、资金对账</p>
        </div>
        <nav className="flex gap-4 text-sm text-slate-600">
          <Link href="/admin" className="hover:text-slate-900">
            概览
          </Link>
          <Link href="/admin/needs" className="hover:text-slate-900">
            需求审核
          </Link>
          <Link href="/admin/reports" className="hover:text-slate-900">
            举报处理
          </Link>
          <Link href="/admin/ledger" className="hover:text-slate-900">
            资金流水
          </Link>
          <Link href="/needs" className="hover:text-slate-900">
            返回前台
          </Link>
        </nav>
      </div>
      <div className="mt-6">{children}</div>
    </div>
  );
}
