-- F29 v0.8：十分钟采集 + 每小时聚合分析
-- 幂等：表不存在时创建，重复执行不报错

CREATE TABLE IF NOT EXISTS "ClueCandidate" (
  "id" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "excerpt" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "authorKey" TEXT NOT NULL,
  "mentionedAt" TIMESTAMP(3) NOT NULL,
  "roundId" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "ClueCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClueCandidate_sourceKey_externalId_key"
  ON "ClueCandidate" ("sourceKey", "externalId");
CREATE INDEX IF NOT EXISTS "ClueCandidate_fetchedAt_idx" ON "ClueCandidate" ("fetchedAt");
CREATE INDEX IF NOT EXISTS "ClueCandidate_usedAt_idx" ON "ClueCandidate" ("usedAt");

CREATE TABLE IF NOT EXISTS "ClueQuery" (
  "id" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "origin" TEXT NOT NULL DEFAULT 'llm',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClueQuery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClueQuery_query_key" ON "ClueQuery" ("query");
CREATE INDEX IF NOT EXISTS "ClueQuery_createdAt_idx" ON "ClueQuery" ("createdAt");
