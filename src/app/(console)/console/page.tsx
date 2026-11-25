import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/infrastructure/prisma/client";
import { NeedService } from "@/domain/need/service";
import { PledgeService } from "@/domain/pledge/service";
import { ProposalService } from "@/domain/proposal/service";
import {
  ConsoleDashboard,
  type ConsoleNeed,
  type ConsolePledge,
  type ConsoleProposal,
  type ConsoleUser,
} from "@/components/console/console-dashboard";

export const dynamic = "force-dynamic";

export default async function ConsolePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      phone: true,
      email: true,
      nickname: true,
      roles: true,
      kycStatus: true,
      reputationScore: true,
    },
  });
  if (!user) redirect("/login");

  let needs: ConsoleNeed[] = [];
  let pledges: ConsolePledge[] = [];
  let proposals: ConsoleProposal[] = [];
  let dbError = false;
  try {
    const [needRes, pledgeRes, proposalRes] = await Promise.all([
      new NeedService().listMine(session.userId),
      new PledgeService().listMine(session.userId),
      new ProposalService().listMine(session.userId),
    ]);
    if (needRes.ok) needs = needRes.value.items as unknown as ConsoleNeed[];
    if (pledgeRes.ok) pledges = pledgeRes.value.items as unknown as ConsolePledge[];
    if (proposalRes.ok) proposals = proposalRes.value.items as unknown as ConsoleProposal[];
  } catch {
    dbError = true;
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-bold">用户控制台</h1>
      <p className="mt-1 text-sm text-slate-500">
        全部模块都在本页切换查看，不需要跳转到其他页面。
      </p>
      <div className="mt-6">
        <ConsoleDashboard
          user={user as ConsoleUser}
          needs={needs}
          pledges={pledges}
          proposals={proposals}
          dbError={dbError}
        />
      </div>
    </main>
  );
}
