-- F28 悬赏模式增量迁移（2026-11-23）
-- 用于**已存在数据**的库：只补新增的类型/列/表，不重建既有表。
-- 新库直接应用 prisma/init.sql 即可，无需本文件。
--
-- 执行方式（服务器）：
--   docker compose -f docker-compose.prod.yml --env-file deploy/.env.production \
--     exec -T postgres psql -v ON_ERROR_STOP=1 -U crowd -d crowd_demand -f - < prisma/patches/2026-11-23-f28-bounty.sql
--
-- 幂等性：本脚本使用 IF NOT EXISTS 保护，可重复执行。

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NeedMode') THEN
    CREATE TYPE "NeedMode" AS ENUM ('CROWDFUND', 'BOUNTY', 'OPEN');
  END IF;
END $$;

ALTER TABLE "Need" ADD COLUMN IF NOT EXISTS "mode" "NeedMode" NOT NULL DEFAULT 'CROWDFUND';
ALTER TABLE "Need" ADD COLUMN IF NOT EXISTS "bountyAmount" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Need" ADD COLUMN IF NOT EXISTS "bountyDeadline" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Need_mode_status_idx" ON "Need"("mode", "status");

CREATE TABLE IF NOT EXISTS "BountyEscrow" (
    "id" TEXT NOT NULL,
    "needId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "refundedAmount" BIGINT NOT NULL DEFAULT 0,
    "paymentRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'HELD',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BountyEscrow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BountyEscrow_needId_key" ON "BountyEscrow"("needId");
CREATE UNIQUE INDEX IF NOT EXISTS "BountyEscrow_idempotencyKey_key" ON "BountyEscrow"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "BountyEscrow_status_idx" ON "BountyEscrow"("status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BountyEscrow_needId_fkey'
  ) THEN
    ALTER TABLE "BountyEscrow"
      ADD CONSTRAINT "BountyEscrow_needId_fkey"
      FOREIGN KEY ("needId") REFERENCES "Need"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
