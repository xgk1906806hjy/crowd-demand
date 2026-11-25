-- F32 用户名密码注册增量迁移（2026-11-23）
-- 用于**已存在数据**的库：只补新增列，不重建既有表。
-- 新库直接应用 prisma/init.sql 即可，无需本文件。
--
-- 执行方式（服务器）：
--   docker compose -f docker-compose.prod.yml --env-file deploy/.env.production \
--     exec -T postgres psql -v ON_ERROR_STOP=1 -U crowd -d crowd_demand -f - < prisma/patches/2026-11-23-f32-username.sql
--
-- 幂等性：本脚本使用 IF NOT EXISTS 保护，可重复执行。

BEGIN;

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "username" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
CREATE INDEX IF NOT EXISTS "User_username_idx" ON "User"("username");

COMMIT;