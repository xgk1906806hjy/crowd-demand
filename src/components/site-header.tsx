import Link from "next/link";
import { getSession } from "@/lib/auth";

/** 全站顶部导航。放在根布局，由 cookie 会话决定展示内容。 */
export async function SiteHeader() {
  const session = await getSession();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="text-base font-bold tracking-tight">
          聚需 <span className="text-xs font-normal text-slate-400">crowd-demand</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm text-slate-600">
          <Link href="/needs" className="hover:text-slate-900">
            需求广场
          </Link>
          <Link href="/needs?sort=pledge" className="hover:text-slate-900">
            承诺榜
          </Link>
          {session ? (
            <>
              <Link
                href="/console/needs/new"
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-700"
              >
                发布需求
              </Link>
              <Link href="/console" className="hover:text-slate-900">
                控制台
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-700"
            >
              登录
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
