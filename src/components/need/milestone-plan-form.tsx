"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Item {
  title: string;
  deliverable: string;
  releaseRatio: number;
}

const DEFAULT_ITEMS: Item[] = [
  { title: "原型与方案确认", deliverable: "可交互原型或详细方案文档，确认核心流程", releaseRatio: 3000 },
  { title: "功能开发完成", deliverable: "全部功能可运行，提供测试环境与使用说明", releaseRatio: 5000 },
  { title: "上线与验收", deliverable: "部署上线，修复验收问题，交付源码", releaseRatio: 2000 },
];

/** 拆分里程碑（F14）：比例合计必须 100%。 */
export function MilestonePlanForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(DEFAULT_ITEMS);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const total = items.reduce((sum, i) => sum + (Number(i.releaseRatio) || 0), 0);

  function update(index: number, key: keyof Item, value: string) {
    setItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? { ...item, [key]: key === "releaseRatio" ? Number(value) : value }
          : item,
      ),
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (total !== 10000) {
      setMessage("放款比例合计必须为 100%");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/projects/${projectId}/milestones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "拆分失败");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const field =
    "mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-slate-900";

  return (
    <form onSubmit={submit} className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50/40 p-4">
      <div className="text-sm font-semibold text-slate-800">拆分里程碑与放款比例</div>
      <p className="mt-1 text-xs text-slate-500">
        建议 2-4 个节点，比例合计 100%。每次验收通过后按比例从托管账户放款。
      </p>

      <div className="mt-3 space-y-3">
        {items.map((item, index) => (
          <div key={index} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">#{index + 1}</span>
              <input
                value={item.title}
                onChange={(e) => update(index, "title", e.target.value)}
                placeholder="节点名称"
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <input
                value={item.releaseRatio / 100}
                onChange={(e) => update(index, "releaseRatio", String(Math.round(Number(e.target.value) * 100)))}
                inputMode="decimal"
                className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <span className="text-xs text-slate-500">%</span>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                  className="text-xs text-slate-400 hover:text-rose-600"
                >
                  删除
                </button>
              )}
            </div>
            <textarea
              value={item.deliverable}
              onChange={(e) => update(index, "deliverable", e.target.value)}
              rows={2}
              placeholder="该节点的交付物与验收标准"
              className={field}
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        {items.length < 5 ? (
          <button
            type="button"
            onClick={() =>
              setItems((prev) => [...prev, { title: "", deliverable: "", releaseRatio: 1000 }])
            }
            className="text-sm text-cyan-700 hover:underline"
          >
            + 添加节点
          </button>
        ) : (
          <span className="text-xs text-slate-400">最多 5 个节点</span>
        )}
        <span className={`text-sm ${total === 10000 ? "text-slate-600" : "text-rose-600"}`}>
          比例合计 {(total / 100).toFixed(2)}%
        </span>
      </div>

      {message && <p className="mt-2 text-sm text-rose-600">{message}</p>}

      <button
        type="submit"
        disabled={busy}
        className="mt-3 rounded-lg bg-cyan-700 px-5 py-2 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-50"
      >
        {busy ? "保存中…" : "保存里程碑"}
      </button>
    </form>
  );
}
