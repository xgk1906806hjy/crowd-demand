/**
 * 测试用内存数据库 —— 仅覆盖资金相关测试所需的 Prisma 方法。
 * 行为对齐真实 Prisma：查询返回对象副本、update 支持 increment/decrement。
 */

export type MemUser = {
  id: string;
  kycStatus: string;
  nickname?: string | null;
  reputationScore?: number;
  roles?: string[];
};
export type MemNeed = {
  id: string;
  status: string;
  deadline: Date | null;
  targetAmount: bigint;
  pledgedAmount: bigint;
  requesterId?: string;
};
export type MemPledge = {
  id: string;
  userId: string;
  needId: string;
  amount: bigint;
  status: string;
  idempotencyKey: string;
  paymentRef?: string | null;
  createdAt: Date;
};
export type MemLedger = {
  id: string;
  accountType: string;
  accountId: string;
  direction: string;
  amount: bigint;
  balanceAfter: bigint;
  bizType: string;
  bizId: string;
  idempotencyKey: string;
  pledgeId?: string | null;
  memo?: string | null;
  createdAt: Date;
};

function applyData(target: Record<string, unknown>, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in (value as object)) {
      target[key] = (target[key] as bigint) + (value as { increment: bigint }).increment;
    } else if (value && typeof value === "object" && "decrement" in (value as object)) {
      target[key] = (target[key] as bigint) - (value as { decrement: bigint }).decrement;
    } else {
      target[key] = value;
    }
  }
}

export function makeFinanceDb() {
  const users = new Map<string, MemUser>();
  const needs = new Map<string, MemNeed>();
  const pledges: MemPledge[] = [];
  const ledger: MemLedger[] = [];
  const orders: Array<Record<string, unknown>> = [];
  const logs: Array<Record<string, unknown>> = [];
  const proposals: Array<Record<string, unknown>> = [];
  const projects: Array<Record<string, unknown>> = [];
  const milestones: Array<Record<string, unknown>> = [];
  const payouts: Array<Record<string, unknown>> = [];
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}${++seq}`;

  const matchPledge = (p: MemPledge, where: Record<string, unknown> = {}) => {
    if (typeof where.needId === "string" && p.needId !== where.needId) return false;
    if (typeof where.userId === "string" && p.userId !== where.userId) return false;
    const status = where.status as { not?: string; in?: string[] } | string | undefined;
    if (typeof status === "string" && p.status !== status) return false;
    if (status && typeof status === "object") {
      if (status.not && p.status === status.not) return false;
      if (status.in && !status.in.includes(p.status)) return false;
    }
    return true;
  };

  const db = {
    user: {
      findUnique: async ({ where }: { where: { id?: string } }) =>
        where.id ? (users.get(where.id) ?? null) : null,
    },
    need: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const n = needs.get(where.id);
        return n ? { ...n } : null;
      },
      findMany: async ({ where }: { where: Record<string, unknown> } = { where: {} }) => {
        return [...needs.values()].filter((n) => {
          const status = where.status as { in?: string[] } | string | undefined;
          if (typeof status === "string" && n.status !== status) return false;
          if (status && typeof status === "object" && status.in && !status.in.includes(n.status)) {
            return false;
          }
          const deadline = where.deadline as { lt?: Date } | undefined;
          if (deadline?.lt && (!n.deadline || n.deadline >= deadline.lt)) return false;
          return true;
        });
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const n = needs.get(where.id);
        if (!n) throw new Error("need not found");
        applyData(n as unknown as Record<string, unknown>, data);
        return { ...n };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status?: string };
        data: Record<string, unknown>;
      }) => {
        const n = needs.get(where.id);
        if (!n) return { count: 0 };
        if (where.status && n.status !== where.status) return { count: 0 };
        applyData(n as unknown as Record<string, unknown>, data);
        return { count: 1 };
      },
    },
    pledge: {
      findUnique: async ({
        where,
      }: {
        where: { id?: string; idempotencyKey?: string };
      }) => {
        if (where.id) return pledges.find((p) => p.id === where.id) ?? null;
        if (where.idempotencyKey) {
          return pledges.find((p) => p.idempotencyKey === where.idempotencyKey) ?? null;
        }
        return null;
      },
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
        pledges
          .filter((p) => matchPledge(p, where ?? {}))
          .map((p) => ({ ...p, user: users.get(p.userId) ?? { nickname: null } })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const p = {
          id: nextId("p"),
          createdAt: new Date(),
          status: "FROZEN",
          ...data,
        } as unknown as MemPledge;
        pledges.push(p);
        return p;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const p = pledges.find((x) => x.id === where.id);
        if (!p) throw new Error("pledge not found");
        applyData(p as unknown as Record<string, unknown>, data);
        return p;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const p of pledges) {
          if (matchPledge(p, where)) {
            applyData(p as unknown as Record<string, unknown>, data);
            count += 1;
          }
        }
        return { count };
      },
      aggregate: async ({ where }: { where?: Record<string, unknown> } = {}) => {
        const list = pledges.filter((p) => matchPledge(p, where ?? {}));
        return { _sum: { amount: list.reduce((sum, p) => sum + p.amount, 0n) } };
      },
    },
    ledgerEntry: {
      findMany: async ({
        where,
      }: {
        where: { accountType: string; accountId: string };
      }) =>
        ledger.filter(
          (e) => e.accountType === where.accountType && e.accountId === where.accountId,
        ),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const e = { id: nextId("l"), createdAt: new Date(), ...data } as unknown as MemLedger;
        ledger.push(e);
        return e;
      },
    },
    paymentOrder: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const o = { id: nextId("o"), createdAt: new Date(), ...data };
        orders.push(o);
        return o;
      },
    },
    needStatusLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const l = { id: nextId("sl"), createdAt: new Date(), ...data };
        logs.push(l);
        return l;
      },
    },
    proposal: {
      findUnique: async ({
        where,
      }: {
        where: {
          id?: string;
          needId_builderId?: { needId: string; builderId: string };
        };
      }) => {
        if (where.id) return proposals.find((p) => p.id === where.id) ?? null;
        if (where.needId_builderId) {
          return (
            proposals.find(
              (p) =>
                p.needId === where.needId_builderId?.needId &&
                p.builderId === where.needId_builderId?.builderId,
            ) ?? null
          );
        }
        return null;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        proposals
          .filter((p) => {
            if (where.needId && p.needId !== where.needId) return false;
            if (where.builderId && p.builderId !== where.builderId) return false;
            return true;
          })
          .map((p) => ({
            ...p,
            builder: users.get(p.builderId as string) ?? {
              nickname: null,
              reputationScore: 0,
            },
          })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const p = { id: nextId("pr"), createdAt: new Date(), ...data };
        proposals.push(p);
        return p;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const p = proposals.find((x) => x.id === where.id);
        if (!p) throw new Error("proposal not found");
        Object.assign(p, data);
        return p;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { needId?: string; id?: { not: string }; status?: string };
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const p of proposals) {
          if (where.needId && p.needId !== where.needId) continue;
          if (where.id?.not && p.id === where.id.not) continue;
          if (where.status && p.status !== where.status) continue;
          Object.assign(p, data);
          count += 1;
        }
        return { count };
      },
    },
    project: {
      findUnique: async ({ where }: { where: { id?: string; needId?: string } }) => {
        const p = projects.find((x) =>
          where.id ? x.id === where.id : x.needId === where.needId,
        );
        if (!p) return null;
        const proposal = proposals.find((pr) => pr.id === p.proposalId) ?? {};
        const builder = users.get(proposal.builderId as string) ?? {
          nickname: null,
          reputationScore: 0,
        };
        const ms = milestones
          .filter((m) => m.projectId === p.id)
          .sort((a, b) => Number(a.seq) - Number(b.seq));
        return {
          ...p,
          proposal: { ...proposal, builder },
          need: needs.get(p.needId as string),
          milestones: ms,
          _count: { milestones: ms.length },
        };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const p = { id: nextId("pj"), createdAt: new Date(), ...data };
        projects.push(p);
        return p;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const p = projects.find((x) => x.id === where.id);
        if (!p) throw new Error("project not found");
        applyData(p, data);
        return p;
      },
    },
    milestone: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const m = milestones.find((x) => x.id === where.id);
        if (!m) return null;
        const project = projects.find((p) => p.id === m.projectId);
        const proposal = proposals.find((pr) => pr.id === project?.proposalId) ?? {};
        return {
          ...m,
          project: project
            ? {
                ...project,
                proposal: { ...proposal, builder: users.get(proposal.builderId as string) },
                need: needs.get(project.needId as string),
                milestones: milestones.filter((x) => x.projectId === project.id),
              }
            : null,
        };
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        milestones.filter((m) => {
          if (where.projectId && m.projectId !== where.projectId) return false;
          const status = where.status as { not?: string } | string | undefined;
          if (typeof status === "string" && m.status !== status) return false;
          if (status && typeof status === "object" && status.not && m.status === status.not) {
            return false;
          }
          return true;
        }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const m = {
          id: nextId("ms"),
          seq: 1,
          status: "PENDING",
          submittedAt: null,
          acceptedAt: null,
          ...data,
        };
        milestones.push(m);
        return m;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const m = milestones.find((x) => x.id === where.id);
        if (!m) throw new Error("milestone not found");
        applyData(m, data);
        return m;
      },
      count: async ({ where }: { where: { projectId: string; status?: { not?: string } } }) =>
        milestones.filter(
          (m) =>
            m.projectId === where.projectId &&
            (!where.status?.not || m.status !== where.status.not),
        ).length,
    },
    payout: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const p = { id: nextId("po"), createdAt: new Date(), ...data };
        payouts.push(p);
        return p;
      },
    },
    $transaction: async (arg: unknown) =>
      typeof arg === "function"
        ? (arg as (tx: unknown) => Promise<unknown>)(db)
        : Promise.all(arg as Promise<unknown>[]),
  };

  return {
    db,
    users,
    needs,
    pledges,
    ledger,
    orders,
    logs,
    proposals,
    projects,
    milestones,
    payouts,
  };
}
