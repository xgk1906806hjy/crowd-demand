"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClueSourceView, ClueView } from "@/domain/clue/service";
import { displayDateTime } from "@/lib/display";

const STATUS_TEXT: Record<string, string> = {
  COLLECTED: "已采集",
  FEATURED: "已收录",
  DISCARDED: "已丢弃",
};

/** 线索审核面板（F29）：收录/丢弃、来源启停、手动采集。 */
export function ClueAdminPanel() {
  const router = useRouter();
  const [items, setItems] = useState<ClueView[]>([]);
  const [sources, setSources] = useState<ClueSourceView[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/clues");
    const data = await res.json();
    if (res.ok) {
      setItems(data.data.items as ClueView[]);
      setSources(data.data.sources as ClueSourceView[]);
    } else {
      setMessage(data.error ?? "加载失败");
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<Response>, okText: string) {
    setMessage("");
    setBusy(true);
    try {
      const res = await fn();
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "操作失败");
        return;
      }
      setMessage(okText);
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const review = (id: string, action: "FEATURE" | "DISCARD") =>
    act(
      () =>
        fetch(`/api/admin/clues/${id}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }),
      action === "FEATURE" ? "已收录" : "已丢弃",
    );

  const toggleSource = (key: string, enabled: boolean) =>
    act(
      () =>
        fetch("/api/admin/clues/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, enabled }),
        }),
      enabled ? "来源已启用" : "来源已停用",
    );

  const collect = () =>
    act(
      () => fetch("/api/admin/clues/collect", { method: "POST" }),
      "采集完成",
    );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">需求线索</h2>
          <p className="mt-1 text-sm text-slate-500">
            共 {items.length} 条。收录后热榜展示徽标；丢弃后热榜隐藏且不再合并新提及。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void collect()}
          disabled={busy}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy ? "处理中…" : "立即采集"}
        </button>
      </div>

      {sources.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">采集来源：</span>
          {sources.map((s) => (
            <button
              key={s.key}
              type="button"
              disabled={busy}
              onClick={() => void toggleSource(s.key, !s.enabled)}
              className={
                "rounded-full px-3 py-1 text-xs ring-1 disabled:opacity-50 " +
                (s.enabled
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : "bg-slate-100 text-slate-400 ring-slate-200")
              }
            >
              {s.name} · {s.enabled ? "启用中" : "已停用"}
            </button>
          ))}
        </div>
      )}

      {message && <p className="mt-3 text-sm text-amber-600">{message}</p>}

      {loaded && items.length === 0 && (
        <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          还没有线索。点「立即采集」跑一次，或等定时任务自动执行。
        </div>
      )}

      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{item.title}</span>
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-xs " +
                      (item.status === "FEATURED"
                        ? "bg-emerald-50 text-emerald-700"
                        : item.status === "DISCARDED"
                          ? "bg-slate-100 text-slate-400"
                          : "bg-slate-100 text-slate-600")
                    }
                  >
                    {STATUS_TEXT[item.status] ?? item.status}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-600">{item.summary}</p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="font-semibold text-slate-900">{item.mentionerCount} 人提及</span>
                  <span>共 {item.mentionCount} 次</span>
                  <span>最近 {displayDateTime(item.lastSeenAt)}</span>
                  {item.sources.map((s) => (
                    <a
                      key={s.sourceKey}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-slate-900"
                    >
                      {s.name} ↗
                    </a>
                  ))}
                </div>
              </div>
              {item.status !== "DISCARDED" && (
                <div className="flex shrink-0 gap-2">
                  {item.status !== "FEATURED" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void review(item.id, "FEATURE")}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
                    >
                      收录
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void review(item.id, "DISCARD")}
                    className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                  >
                    丢弃
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
