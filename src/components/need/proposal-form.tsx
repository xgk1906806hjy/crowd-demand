"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  needId: string;
  maxQuoteYuan: string;
}

/** 开发者提交提案（F12）。 */
export function ProposalForm({ needId, maxQuoteYuan }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    understanding: "",
    spec: "",
    quoteYuan: "",
    durationDays: "14",
    pastCases: "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/needs/${needId}/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          understanding: form.understanding,
          spec: form.spec,
          quoteYuan: form.quoteYuan,
          durationDays: Number(form.durationDays),
          pastCases: form.pastCases || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "提交失败");
        return;
      }
      setMessage("提案已提交，等待发起者选标");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const field =
    "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900";

  return (
    <form onSubmit={submit} className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <div className="text-sm font-semibold text-slate-800">我是开发者，提交方案</div>
      <p className="mt-1 text-xs text-slate-500">
        同一需求只能提交一份提案；报价不得超过已托管金额 ¥{maxQuoteYuan}。
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor="understanding" className="text-xs font-medium text-slate-600">
            需求理解（≥30 字）
          </label>
          <textarea
            id="understanding"
            rows={3}
            value={form.understanding}
            onChange={(e) => update("understanding", e.target.value)}
            placeholder="你怎么理解这个痛点？谁会用它？"
            className={field}
          />
        </div>
        <div>
          <label htmlFor="spec" className="text-xs font-medium text-slate-600">
            可执行规格（≥50 字）
          </label>
          <textarea
            id="spec"
            rows={5}
            value={form.spec}
            onChange={(e) => update("spec", e.target.value)}
            placeholder="技术方案、功能范围、交付物、验收方式"
            className={field}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="quote" className="text-xs font-medium text-slate-600">
              报价（元）
            </label>
            <input
              id="quote"
              value={form.quoteYuan}
              onChange={(e) => update("quoteYuan", e.target.value)}
              inputMode="decimal"
              className={field}
            />
          </div>
          <div>
            <label htmlFor="duration" className="text-xs font-medium text-slate-600">
              工期（天）
            </label>
            <input
              id="duration"
              value={form.durationDays}
              onChange={(e) => update("durationDays", e.target.value)}
              inputMode="numeric"
              className={field}
            />
          </div>
        </div>
        <div>
          <label htmlFor="pastCases" className="text-xs font-medium text-slate-600">
            过往案例（选填）
          </label>
          <textarea
            id="pastCases"
            rows={2}
            value={form.pastCases}
            onChange={(e) => update("pastCases", e.target.value)}
            className={field}
          />
        </div>
      </div>

      {message && <p className="mt-2 text-sm text-violet-700">{message}</p>}

      <button
        type="submit"
        disabled={busy}
        className="mt-3 rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
      >
        {busy ? "提交中…" : "提交提案"}
      </button>
    </form>
  );
}
