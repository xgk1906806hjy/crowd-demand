import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { NeedQueryService } from "@/domain/need/query";
import { StatusBadge } from "@/components/need/status-badge";
import { Progress } from "@/components/need/progress";
import { VoteButton } from "@/components/need/vote-button";
import { NeedActions } from "@/components/need/need-actions";
import { PledgeForm } from "@/components/need/pledge-form";
import { PledgeService } from "@/domain/pledge/service";
import type { PledgeView } from "@/domain/pledge/service";
import { ProposalService } from "@/domain/proposal/service";
import type { ProposalView } from "@/domain/proposal/service";
import { ProposalForm } from "@/components/need/proposal-form";
import { SelectProposalButton } from "@/components/need/select-proposal-button";
import { MilestoneService } from "@/domain/milestone/service";
import type { ProjectView } from "@/domain/milestone/service";
import { MilestonePlanForm } from "@/components/need/milestone-plan-form";
import { MilestoneActions } from "@/components/need/milestone-actions";
import { ReportButton } from "@/components/need/report-button";
import { centsToYuan } from "@/lib/money";
import { displayMoney, displayDate, displayDateTime, daysLeft } from "@/lib/display";
import { NEED_STATUS_LABEL, isVotable } from "@/domain/need/state-machine";

export const dynamic = "force-dynamic";

export default async function NeedDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  let detail: Awaited<ReturnType<NeedQueryService["detail"]>> | null = null;
  try {
    detail = await new NeedQueryService().detail(id, session?.userId ?? null);
  } catch {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          数据库未连接，暂时无法加载需求详情。
        </div>
      </main>
    );
  }

  if (!detail || !detail.ok) notFound();
  const need = detail.value;
  const left = daysLeft(need.deadline);

  let pledges: PledgeView[] = [];
  try {
    const res = await new PledgeService().listByNeed(id, 10);
    if (res.ok) pledges = res.value.items;
  } catch {
    pledges = [];
  }

  let proposals: ProposalView[] = [];
  try {
    const res = await new ProposalService().listByNeed(id);
    if (res.ok) proposals = res.value.items;
  } catch {
    proposals = [];
  }
  const hasProposed = session ? proposals.some((p) => p.builderId === session.userId) : false;

  let project: ProjectView | null = null;
  try {
    const res = await new MilestoneService().getByNeed(id, session?.userId ?? null);
    if (res.ok) project = res.value;
  } catch {
    project = null;
  }

  const MILESTONE_STATUS_LABEL: Record<string, string> = {
    PENDING: "未开始",
    SUBMITTED: "待验收",
    ACCEPTED: "已验收",
    DISPUTED: "待修改",
    RELEASED: "已放款",
  };

  const PROPOSAL_STATUS_LABEL: Record<string, string> = {
    SUBMITTED: "待选",
    SELECTED: "已中标",
    REJECTED: "未中选",
    WITHDRAWN: "已撤回",
  };

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/needs" className="text-sm text-slate-500 hover:text-slate-900">
        ← 返回需求广场
      </Link>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <StatusBadge status={need.status} />
              <span className="text-xs text-slate-400">发起者 {need.requesterName}</span>
            </div>
            <h1 className="mt-2 text-2xl font-bold leading-8">{need.title}</h1>
            <p className="mt-1 text-xs text-slate-400">
              发布于 {displayDate(need.publishedAt)} · 截止 {displayDate(need.deadline)}
              {left !== null && left > 0 ? ` · 剩 ${left} 天` : ""}
            </p>
            {session && (
              <div className="mt-1">
                <ReportButton targetId={need.id} targetType="NEED" />
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <VoteButton
              needId={need.id}
              initialCount={need.voteCount}
              initialVoted={need.viewer.hasVoted}
              loggedIn={need.viewer.loggedIn}
              kycVerified={need.viewer.kycVerified}
              votable={isVotable(need.status)}
            />
            {need.viewer.isRequester && (need.status === "DRAFT" || need.status === "COLLECTING") && (
              <NeedActions
                needId={need.id}
                status={need.status === "DRAFT" ? "DRAFT" : "COLLECTING"}
              />
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 text-sm md:grid-cols-4">
          <div>
            <div className="text-xs text-slate-500">支持票数</div>
            <div className="mt-1 text-lg font-semibold">
              {need.voteCount}
              <span className="ml-1 text-xs font-normal text-slate-400">/ {need.voteThreshold} 票</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">目标金额</div>
            <div className="mt-1 text-lg font-semibold">{displayMoney(need.targetAmount)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">已承诺</div>
            <div className="mt-1 text-lg font-semibold text-emerald-600">
              {displayMoney(need.pledgedAmount)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">承诺进度</div>
            <div className="mt-1 text-lg font-semibold">{need.progress}%</div>
          </div>
        </div>

        <div className="mt-3">
          <Progress value={need.progress} />
        </div>

        {need.status === "PLEDGING" && (
          <section className="mt-6">
            <PledgeForm
              needId={need.id}
              loggedIn={need.viewer.loggedIn}
              kycVerified={need.viewer.kycVerified}
              targetAmount={need.targetAmount}
              pledgedAmount={need.pledgedAmount}
            />
          </section>
        )}

        {pledges.length > 0 && (
          <section className="mt-6 rounded-xl border border-slate-200 p-4">
            <div className="text-sm font-semibold text-slate-700">最近支持</div>
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {pledges.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <span className="text-slate-600">{p.backerName}</span>
                  <span className="font-medium">{displayMoney(p.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {(need.status === "BIDDING" || proposals.length > 0) && (
          <section className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">
                开发方案（{proposals.length}）
              </h2>
              {need.status === "BIDDING" && (
                <span className="text-xs text-slate-400">发起者选定方案后进入开发</span>
              )}
            </div>

            {proposals.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">还没有开发者提交方案。</p>
            ) : (
              <div className="mt-3 space-y-3">
                {proposals.map((p) => (
                  <article
                    key={p.id}
                    className={`rounded-xl border p-4 ${
                      p.status === "SELECTED"
                        ? "border-emerald-400 bg-emerald-50/40"
                        : "border-slate-200"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{p.builderName}</span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                            信誉 {p.builderReputation}
                          </span>
                          <span className="text-xs text-slate-500">
                            {PROPOSAL_STATUS_LABEL[p.status] ?? p.status}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-slate-700">
                          报价 {displayMoney(p.quote)} · 工期 {p.durationDays} 天
                        </div>
                      </div>
                      {need.viewer.isRequester &&
                        need.status === "BIDDING" &&
                        p.status === "SUBMITTED" && (
                          <SelectProposalButton
                            needId={need.id}
                            proposalId={p.id}
                            builderName={p.builderName}
                          />
                        )}
                    </div>

                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer text-slate-500">查看方案详情</summary>
                      <div className="mt-2 space-y-2">
                        <div>
                          <div className="text-xs font-medium text-slate-500">需求理解</div>
                          <p className="whitespace-pre-wrap text-slate-700">{p.understanding}</p>
                        </div>
                        <div>
                          <div className="text-xs font-medium text-slate-500">可执行规格</div>
                          <p className="whitespace-pre-wrap text-slate-700">{p.spec}</p>
                        </div>
                        {p.pastCases && (
                          <div>
                            <div className="text-xs font-medium text-slate-500">过往案例</div>
                            <p className="whitespace-pre-wrap text-slate-700">{p.pastCases}</p>
                          </div>
                        )}
                      </div>
                    </details>
                  </article>
                ))}
              </div>
            )}

            {need.status === "BIDDING" &&
              need.viewer.isBuilder &&
              need.viewer.kycVerified &&
              !hasProposed && (
                <div className="mt-4">
                  <ProposalForm
                    needId={need.id}
                    maxQuoteYuan={centsToYuan(BigInt(need.pledgedAmount))}
                  />
                </div>
              )}

            {need.status === "BIDDING" && need.viewer.loggedIn && !need.viewer.isBuilder && (
              <p className="mt-3 text-sm text-slate-500">
                想接这个需求？
                <Link href="/console/profile" className="underline">
                  申请开发者角色
                </Link>
                后可提交方案。
              </p>
            )}
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-slate-700">痛点与场景</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">
            {need.description}
          </p>
        </section>

        {(need.targetAudience || need.expectedForm) && (
          <section className="mt-6 grid gap-4 md:grid-cols-2">
            {need.targetAudience && (
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs text-slate-500">目标人群</div>
                <p className="mt-1 text-sm text-slate-700">{need.targetAudience}</p>
              </div>
            )}
            {need.expectedForm && (
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="text-xs text-slate-500">期望形态</div>
                <p className="mt-1 text-sm text-slate-700">{need.expectedForm}</p>
              </div>
            )}
          </section>
        )}

        {need.attachments.length > 0 && (
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-slate-700">附件</h2>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              {need.attachments.map((a) => (
                <li key={a} className="font-mono text-xs">
                  {a}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {project && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">项目执行</h2>
              <p className="mt-1 text-xs text-slate-400">
                中标开发者：{project.builderName} · 报价 {displayMoney(project.quote)}
              </p>
            </div>
            <div className="text-right text-xs text-slate-500">
              托管 {displayMoney(project.totalAmount)} · 已放款 {displayMoney(project.releasedAmount)}
              <div className="text-[11px] text-slate-400">{project.status}</div>
            </div>
          </div>

          <ol className="mt-4 space-y-3">
            {project.milestones.map((m) => (
              <li key={m.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">#{m.seq}</span>
                      <span className="font-medium">{m.title}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {MILESTONE_STATUS_LABEL[m.status] ?? m.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{m.deliverable}</p>
                    <div className="mt-1 text-xs text-slate-500">
                      放款 {(m.releaseRatio / 100).toFixed(2)}% · {displayMoney(m.releaseAmount)}
                    </div>
                  </div>
                  {project.viewer.isBuilder && m.status === "PENDING" && (
                    <MilestoneActions milestoneId={m.id} mode="submit" />
                  )}
                  {project.viewer.isRequester && m.status === "SUBMITTED" && (
                    <MilestoneActions milestoneId={m.id} mode="accept" />
                  )}
                </div>
              </li>
            ))}
          </ol>

          {project.milestones.length === 0 && (
            <p className="mt-3 text-sm text-slate-500">尚未拆分里程碑。</p>
          )}

          {project.viewer.canPlan && <MilestonePlanForm projectId={project.projectId} />}
        </section>
      )}

      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-700">生命周期</h2>
        <ol className="mt-4 space-y-4">
          {need.statusLogs.map((log) => (
            <li key={log.id} className="flex gap-3 text-sm">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
              <div>
                <div className="text-slate-700">
                  {log.fromStatus ? `${NEED_STATUS_LABEL[log.fromStatus]} → ` : ""}
                  <span className="font-medium">{NEED_STATUS_LABEL[log.toStatus]}</span>
                </div>
                {log.reason && <div className="text-xs text-slate-500">{log.reason}</div>}
                <div className="text-xs text-slate-400">{displayDateTime(log.createdAt)}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
