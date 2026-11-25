"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { NeedStatus } from "@prisma/client";
import { StatusBadge } from "@/components/need/status-badge";
import { displayDate, displayMoney } from "@/lib/display";
import { KycPanel } from "@/components/console/kyc-panel";
import { RolePanel, ROLE_TEXT } from "@/components/console/role-panel";
import { NewNeedForm } from "@/components/need/new-need-form";

export interface ConsoleUser {
  phone: string | null;
  email: string | null;
  nickname: string | null;
  roles: string[];
  kycStatus: "NONE" | "PENDING" | "VERIFIED" | "REJECTED";
  reputationScore: number;
}

export interface ConsoleNeed {
  id: string;
  title: string;
  status: NeedStatus;
  statusLabel: string;
  mode?: "CROWDFUND" | "BOUNTY" | "OPEN";
  modeLabel?: string;
  bountyAmount?: string;
  voteCount: number;
  voteThreshold: number;
  targetAmount: string;
  pledgedAmount: string;
  publishedAt: string | null;
  createdAt: string;
}

export interface ConsolePledge {
  id: string;
  amount: string;
  status: string;
  createdAt: string;
  needId: string;
  needTitle: string;
}

export interface ConsoleProposal {
  id: string;
  quote: string;
  durationDays: number;
  status: string;
  createdAt: string;
  needId: string;
  needTitle: string;
}

const KYC_TEXT: Record<ConsoleUser["kycStatus"], string> = {
  NONE: "未认证",
  PENDING: "审核中",
  VERIFIED: "已认证",
  REJECTED: "未通过",
};

const PLEDGE_TEXT: Record<string, string> = {
  FROZEN: "托管中",
  LOCKED: "已锁定",
  RELEASED: "已放款",
  REFUNDED: "已退款",
};

const PROPOSAL_TEXT: Record<string, string> = {
  SUBMITTED: "待选",
  SELECTED: "已中标",
  REJECTED: "未中选",
  WITHDRAWN: "已撤回",
};

type TabKey = "overview" | "kyc" | "roles" | "needs" | "pledges" | "proposals" | "publish";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "概览" },
  { key: "kyc", label: "实名认证" },
  { key: "roles", label: "角色与信誉" },
  { key: "needs", label: "我的需求" },
  { key: "pledges", label: "我的承诺" },
  { key: "proposals", label: "我的提案" },
  { key: "publish", label: "发布需求" },
];

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

/** 用户控制台：所有模块在页内切换展示，不再整页跳转。 */
export function ConsoleDashboard({
  user,
  needs,
  pledges,
  proposals,
  dbError,
}: {
  user: ConsoleUser;
  needs: ConsoleNeed[];
  pledges: ConsolePledge[];
  proposals: ConsoleProposal[];
  dbError: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("overview");

  const activeTotal = useMemo(
    () =>
      pledges
        .filter((p) => p.status === "FROZEN" || p.status === "LOCKED")
        .reduce((sum, p) => sum + BigInt(p.amount), 0n),
    [pledges],
  );
  const activeCount = pledges.filter((p) => p.status === "FROZEN" || p.status === "LOCKED").length;
  const verified = user.kycStatus === "VERIFIED";

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              "rounded-lg px-3.5 py-2 text-sm transition " +
              (tab === t.key
                ? "bg-slate-900 font-medium text-white"
                : "border border-slate-300 text-slate-700 hover:border-slate-900")
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {dbError && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          数据库未连接，部分数据暂时无法加载。
        </div>
      )}

      <div className="mt-5">
        {tab === "overview" && (
          <div className="space-y-5">
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <dt className="text-slate-500">账号</dt>
                <dd>{user.phone ?? user.email ?? user.nickname ?? "—"}</dd>
                <dt className="text-slate-500">昵称</dt>
                <dd>{user.nickname ?? "未设置"}</dd>
                <dt className="text-slate-500">角色</dt>
                <dd>{user.roles.map((r) => ROLE_TEXT[r] ?? r).join("、") || "—"}</dd>
                <dt className="text-slate-500">实名状态</dt>
                <dd className={verified ? "text-emerald-600" : "text-amber-600"}>
                  {KYC_TEXT[user.kycStatus]}
                </dd>
                <dt className="text-slate-500">信誉分</dt>
                <dd>{user.reputationScore}</dd>
              </dl>
            </section>

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "我发布的需求", value: `${needs.length}`, tab: "needs" as TabKey },
                { label: "托管中承诺", value: displayMoney(activeTotal), tab: "pledges" as TabKey },
                { label: "我的提案", value: `${proposals.length}`, tab: "proposals" as TabKey },
                { label: "实名认证", value: verified ? "已完成" : "未完成", tab: "kyc" as TabKey },
              ].map((c) => (
                <button
                  key={c.label}
                  type="button"
                  onClick={() => setTab(c.tab)}
                  className="rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-slate-400"
                >
                  <div className="text-xs text-slate-500">{c.label}</div>
                  <div className="mt-1 text-lg font-semibold">{c.value}</div>
                </button>
              ))}
            </section>

            <section className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setTab("publish")}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
              >
                发布需求
              </button>
              <button
                type="button"
                onClick={() => setTab(verified ? "needs" : "kyc")}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:border-slate-900"
              >
                {verified ? "查看我的需求" : "先完成实名认证"}
              </button>
              <Link
                href="/needs"
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:border-slate-900"
              >
                去需求广场
              </Link>
            </section>

            <p className="text-xs text-slate-400">
              投票与领取需求已对所有登录用户开放（一人一票）；涉及资金的领取与承诺仍需实名认证。
            </p>
          </div>
        )}

        {tab === "kyc" && <KycPanel initialStatus={user.kycStatus} />}

        {tab === "roles" && <RolePanel initialRoles={user.roles} />}

        {tab === "needs" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">共 {needs.length} 条</p>
            {needs.length === 0 && <Empty>还没有发布过需求。切到「发布需求」开始第一条。</Empty>}
            {needs.map((item) => (
              <Link
                key={item.id}
                href={`/needs/${item.id}`}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={item.status} />
                    {item.modeLabel && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {item.modeLabel}
                      </span>
                    )}
                    <span className="text-xs text-slate-400">
                      {displayDate(item.publishedAt ?? item.createdAt)}
                    </span>
                  </div>
                  <div className="mt-1 font-medium">{item.title}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {item.mode === "BOUNTY"
                      ? `悬赏 ${displayMoney(item.bountyAmount ?? "0")} · 已全额托管`
                      : item.mode === "OPEN"
                        ? "无偿求助 · 开发者自愿接单"
                        : `${item.voteCount}/${item.voteThreshold} 票 · 已承诺 ${displayMoney(item.pledgedAmount)} / ${displayMoney(item.targetAmount)}`}
                  </div>
                </div>
                <span className="text-sm text-slate-400">→</span>
              </Link>
            ))}
          </div>
        )}

        {tab === "pledges" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              托管中 {activeCount} 笔，合计 {displayMoney(activeTotal)}
            </p>
            {pledges.length === 0 && (
              <Empty>
                还没有承诺过任何需求。
                <Link href="/needs" className="text-slate-900 underline">
                  去需求广场看看
                </Link>
              </Empty>
            )}
            {pledges.map((item) => (
              <Link
                key={item.id}
                href={`/needs/${item.needId}`}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400"
              >
                <div>
                  <div className="font-medium">{item.needTitle}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {displayDate(item.createdAt)} · {PLEDGE_TEXT[item.status] ?? item.status}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{displayMoney(item.amount)}</div>
                  <div className="text-xs text-slate-400">预购订金</div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {tab === "proposals" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              在竞标中的需求下提交方案，发起者选定后进入开发阶段。
            </p>
            {proposals.length === 0 && (
              <Empty>
                还没有提交过提案。
                <Link href="/needs" className="text-slate-900 underline">
                  去需求广场找需求
                </Link>
              </Empty>
            )}
            {proposals.map((item) => (
              <Link
                key={item.id}
                href={`/needs/${item.needId}`}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400"
              >
                <div>
                  <div className="font-medium">{item.needTitle}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {displayDate(item.createdAt)} · 工期 {item.durationDays} 天 ·{" "}
                    <span
                      className={
                        item.status === "SELECTED"
                          ? "text-emerald-600"
                          : item.status === "REJECTED"
                            ? "text-slate-400"
                            : "text-violet-600"
                      }
                    >
                      {PROPOSAL_TEXT[item.status] ?? item.status}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{displayMoney(item.quote)}</div>
                  <div className="text-xs text-slate-400">报价</div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {tab === "publish" && (
          <div>
            <p className="mb-4 text-sm text-slate-500">
              先把需求说清楚，再决定用哪种方式找人做。发布需已完成实名认证。
            </p>
            {verified ? (
              <NewNeedForm />
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
                发布需求前需先完成实名认证。
                <button
                  type="button"
                  onClick={() => setTab("kyc")}
                  className="ml-2 underline"
                >
                  去认证
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
