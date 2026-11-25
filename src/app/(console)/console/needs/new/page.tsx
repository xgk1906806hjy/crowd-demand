import { NewNeedForm } from "@/components/need/new-need-form";

export default function NewNeedPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-bold">发布需求</h1>
      <p className="mt-1 text-sm text-slate-500">
        先把需求说清楚，再决定用哪种方式找人做。发布需已完成实名认证。
      </p>
      <div className="mt-6">
        <NewNeedForm />
      </div>
    </main>
  );
}
