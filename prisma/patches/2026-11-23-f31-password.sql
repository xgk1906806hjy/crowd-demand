-- F31 账号密码登录增量迁移（2026-11-23）
-- 用于**已存在数据**的库：只补新增列，不重建既有表。
-- 新库直接应用 prisma/init.sql 即可，无需本文件。
--
-- 执行方式（服务器）：
--   docker compose -f docker-compose.prod.yml --env-file deploy/.env.production \
--     exec -T postgres psql -v ON_ERROR_STOP=1 -U crowd -d crowd_demand -f - < prisma/patches/2026-11-23-f31-password.sql
--
-- 幂等性：本脚本使用 IF NOT EXISTS 保护，可重复执行。

BEGIN;

-- email 列在初始 schema 已存在，这里兜底保护（历史库若缺失则补上）
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordLockedUntil" TIMESTAMP(3);

COMMIT;
