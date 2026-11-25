"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const DESC_MIN = 30;

type NeedMode = "BOUNTY" | "OPEN" | "CROWDFUND";

const MODE_CARDS: { value: NeedMode; title: string; hint: string; badge: string }[] = [
  {
    value: "BOUNTY",
    title: "有偿悬赏",
    hint: "你出钱，预付到托管。发布后开发者直接提方案，你挑一个开工，验收后按节点放款。",
    badge: "最常见",
  },
  {
    value: "OPEN",
    title: "无偿求助",
    hint: "免费发布，愿意帮忙的开发者自愿接单。不涉及资金，适合小工具和协作需求。",
    badge: "免费",
  },
  {
    value: "CROWDFUND",
    title: "众筹",
    hint: "先征集投票，凑够付费承诺再开工。适合「大家都想要、但单个人不愿出全款」的公共需求。",
    badge: "多人凑钱",
  },
];

/** 发布需求表单（F04 / F28）。所有校验以服务端为准，前端只做即时提示。 */
export function NewNeedForm() {
  const router = useRouter();
  const [mode, setMode] = useState<NeedMode>("BOUNTY");
  const [form, setForm] = useState({
    title: "",
    description: "",
    targetAudience: "",
    expectedForm: "",
    targetAmountYuan: "",
    voteThreshold: "100",
    deadline: "",
    bountyAmountYuan: "",
    bountyDays: "14",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<{ url: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setMessage("");
    try {
      for (const file of Array.from(files)) {
        if (attachments.length >= 9) {
          setMessage("附件最多 9 个");
          break;
        }
        const body = new FormData();
        body.append("file", file);
        const res = await fetch("/api/uploads", { method: "POST", body });
        const data = await res.json();
        if (!res.ok) {
          setMessage(data.error ?? "附件上传失败");
          break;
        }
        setAttachments((prev) => [...prev, { url: data.data.url as string, name: data.data.name as string }]);
      }
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (form.description.trim().length < DESC_MIN) {
      setMessage(`痛点描述至少 ${DESC_MIN} 字，写清现状、使用场景和期望效果`);
      return;
    }
    if (mode === "BOUNTY" && !form.bountyAmountYuan.trim()) {
      setMessage("请填写悬赏金额，悬赏需求需要先预付到托管");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/needs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          targetAudience: form.targetAudience || null,
          expectedForm: form.expectedForm || null,
          mode,
          targetAmountYuan: mode === "CROWDFUND" ? form.targetAmountYuan : undefined,
          bountyAmountYuan: mode === "BOUNTY" ? form.bountyAmountYuan : undefined,
          bountyDays: mode === "CROWDFUND" ? undefined : form.bountyDays,
          voteThreshold: mode === "CROWDFUND" ? form.voteThreshold : undefined,
          deadline:
            mode === "CROWDFUND" && form.deadline
              ? new Date(form.deadline).toISOString()
              : null,
          attachments: attachments.map((a) => a.url),
          publish: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "发布失败");
        return;
      }
      router.push(`/needs/${data.data.id as string}`);
    } finally {
      setBusy(false);
    }
  }

  const field =
    "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900";

  return (
    <form onSubmit={submit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
      <div>
        <span className="text-sm font-medium text-slate-700">选择方式</span>
        <div className="mt-2 grid gap-3 md:grid-cols-3">
          {MODE_CARDS.map((m) => {
            const active = mode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                className={
                  "rounded-xl border p-3 text-left transition " +
                  (active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-400")
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{m.title}</span>
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[10px] " +
                      (active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500")
                    }
                  >
                    {m.badge}
                  </span>
                </div>
                <p className={"mt-1 text-xs leading-5 " + (active ? "text-slate-200" : "text-slate-500")}>
                  {m.hint}
                </p>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-400">发布后不可更改模式，选错需重新发布。</p>
      </div>

      <div>
        <label htmlFor="title" className="text-sm font-medium text-slate-700">
          需求标题
        </label>
        <input
          id="title"
          value={form.title}
          onChange={(e) => update("title", e.target.value)}
          maxLength={60}
          placeholder="例：能自动把微信群里的会议通知整理成日程的工具"
          className={field}
        />
        <p className="mt-1 text-xs text-slate-400">5-60 字，一句话讲清要解决什么</p>
      </div>

      <div>
        <label htmlFor="description" className="text-sm font-medium text-slate-700">
          痛点描述
        </label>
        <textarea
          id="description"
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          rows={8}
          placeholder="现在是怎么做的？哪里最麻烦？多久发生一次？希望达到什么效果？"
          className={field}
        />
        <p className="mt-1 text-xs text-slate-400">
          至少 {DESC_MIN} 字（当前 {form.description.trim().length} 字）
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="audience" className="text-sm font-medium text-slate-700">
            目标人群
          </label>
          <input
            id="audience"
            value={form.targetAudience}
            onChange={(e) => update("targetAudience", e.target.value)}
            placeholder="例：经常开线上会的小团队"
            className={field}
          />
        </div>
        <div>
          <label htmlFor="form" className="text-sm font-medium text-slate-700">
            期望形态
          </label>
          <input
            id="form"
            value={form.expectedForm}
            onChange={(e) => update("expectedForm", e.target.value)}
            placeholder="例：网页工具 / 小程序 / 桌面插件"
            className={field}
          />
        </div>
      </div>

      {mode === "BOUNTY" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="bounty" className="text-sm font-medium text-slate-700">
              悬赏金额（元）
            </label>
            <input
              id="bounty"
              value={form.bountyAmountYuan}
              onChange={(e) => update("bountyAmountYuan", e.target.value)}
              inputMode="decimal"
              placeholder="2000"
              className={field}
            />
            <p className="mt-1 text-xs text-slate-400">
              ≥100 元。发布时立即预付到托管，没花完的部分验收后自动退回。
            </p>
          </div>
          <div>
            <label htmlFor="bountyDays" className="text-sm font-medium text-slate-700">
              方案征集期（天）
            </label>
            <input
              id="bountyDays"
              value={form.bountyDays}
              onChange={(e) => update("bountyDays", e.target.value)}
              inputMode="numeric"
              className={field}
            />
            <p className="mt-1 text-xs text-slate-400">1-60 天，到期没人提方案可撤回并全额退款。</p>
          </div>
        </div>
      )}

      {mode === "OPEN" && (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="bountyDaysOpen" className="text-sm font-medium text-slate-700">
              方案征集期（天）
            </label>
            <input
              id="bountyDaysOpen"
              value={form.bountyDays}
              onChange={(e) => update("bountyDays", e.target.value)}
              inputMode="numeric"
              className={field}
            />
          </div>
          <p className="self-center rounded-lg bg-emerald-50 p-3 text-xs leading-5 text-emerald-700">
            无偿模式不收钱、不托管，开发者自愿接单。适合开源、互助和小工具需求。
          </p>
        </div>
      )}

      {mode === "CROWDFUND" && (
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="amount" className="text-sm font-medium text-slate-700">
              承诺目标金额（元）
            </label>
            <input
              id="amount"
              value={form.targetAmountYuan}
              onChange={(e) => update("targetAmountYuan", e.target.value)}
              inputMode="decimal"
              placeholder="5000"
              className={field}
            />
          </div>
          <div>
            <label htmlFor="threshold" className="text-sm font-medium text-slate-700">
              进入承诺期票数
            </label>
            <input
              id="threshold"
              value={form.voteThreshold}
              onChange={(e) => update("voteThreshold", e.target.value)}
              inputMode="numeric"
              className={field}
            />
          </div>
          <div>
            <label htmlFor="deadline" className="text-sm font-medium text-slate-700">
              承诺截止时间
            </label>
            <input
              id="deadline"
              type="datetime-local"
              value={form.deadline}
              onChange={(e) => update("deadline", e.target.value)}
              className={field}
            />
          </div>
        </div>
      )}

      <div>
        <label htmlFor="attachments" className="text-sm font-medium text-slate-700">
          附件（可选）
        </label>
        <input
          id="attachments"
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,application/pdf"
          disabled={uploading}
          onChange={(e) => void uploadFiles(e.target.files)}
          className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-2 file:text-sm file:text-white hover:file:bg-slate-700 disabled:opacity-50"
        />
        <p className="mt-1 text-xs text-slate-400">
          最多 9 个，单个不超过 5MB，支持 PNG / JPEG / WebP / PDF
          {uploading && "（上传中…）"}
        </p>
        {attachments.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {attachments.map((a) => (
              <li key={a.url} className="flex items-center justify-between gap-2">
                <a href={a.url} target="_blank" rel="noreferrer" className="truncate hover:underline">
                  {a.name}
                </a>
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.url !== a.url))}
                  className="text-rose-600 hover:underline"
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-500">
        说明：本平台资金属于「预购订金 / 定制款」，由持牌机构托管，未使用部分原路退回；平台不承诺任何投资收益。
      </p>

      {message && <p className="text-sm text-rose-600">{message}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {busy
            ? "发布中…"
            : mode === "BOUNTY"
              ? form.bountyAmountYuan
                ? `支付 ¥${form.bountyAmountYuan} 并发布`
                : "支付悬赏金并发布"
              : "发布需求"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm hover:border-slate-900"
        >
          取消
        </button>
      </div>
    </form>
  );
}
