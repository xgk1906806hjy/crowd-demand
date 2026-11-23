import { NextResponse } from "next/server";
import { prisma } from "@/infrastructure/prisma/client";

export const dynamic = "force-dynamic";

/**
 * 健康检查：用于容器探针与部署后验证。
 * 数据库不可用时返回 503，便于发现"服务起来了但库没连上"的情况。
 */
export async function GET() {
  const startedAt = Date.now();
  let db: "up" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch {
    db = "down";
  }

  return NextResponse.json(
    {
      status: db === "up" ? "ok" : "degraded",
      db,
      latencyMs: Date.now() - startedAt,
      uptimeSec: Math.round(process.uptime()),
      version: process.env.npm_package_version ?? "0.1.0",
      time: new Date().toISOString(),
    },
    { status: db === "up" ? 200 : 503 },
  );
}
