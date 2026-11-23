import { prisma } from "@/infrastructure/prisma/client";

export interface ReputationView {
  score: number;
  completedProjects: number;
  totalProjects: number;
  refundedProjects: number;
  refundRate: number; // 0–1
}

const BASE_SCORE = 60;
const COMPLETED_BONUS = 8;
const REFUND_PENALTY = 10;

/** 基础版信誉分：以开发者身份的项目履约为准。 */
export class ReputationService {
  constructor(private readonly db: typeof prisma = prisma) {}

  async compute(userId: string): Promise<ReputationView> {
    const builderFilter = { proposal: { builderId: userId } };
    const [totalProjects, completedProjects, refundedProjects] = await Promise.all([
      this.db.project.count({ where: builderFilter }),
      this.db.project.count({ where: { ...builderFilter, status: "COMPLETED" } }),
      this.db.project.count({ where: { ...builderFilter, status: "REFUNDED" } }),
    ]);

    const refundRate = totalProjects === 0 ? 0 : refundedProjects / totalProjects;
    const raw = BASE_SCORE + completedProjects * COMPLETED_BONUS - refundedProjects * REFUND_PENALTY;
    const score = Math.max(0, Math.min(100, raw));

    return { score, completedProjects, totalProjects, refundedProjects, refundRate };
  }

  /** 计算并写回 User.reputationScore。 */
  async refresh(userId: string): Promise<ReputationView> {
    const view = await this.compute(userId);
    await this.db.user.update({
      where: { id: userId },
      data: { reputationScore: view.score },
    });
    return view;
  }
}
