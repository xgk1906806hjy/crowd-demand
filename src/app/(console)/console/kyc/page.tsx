import Link from "next/link";
import { KycPanel } from "@/components/console/kyc-panel";

export default function KycPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <Link href="/console" className="text-sm text-slate-500 hover:underline">
        ← 返回控制台
      </Link>
      <h1 className="mt-4 text-2xl font-bold">实名认证</h1>
      <div className="mt-4">
        <KycPanel />
      </div>
    </main>
  );
}
