-- F29 平台需求采集：线索聚合相关表（幂等，可重复执行）
-- 用法：docker exec -i crowd-demand-db psql -U crowd -d crowd_demand < prisma/patches/2026-11-24-f29-clues.sql

DO $$ BEGIN
  CREATE TYPE "ClueStatus" AS ENUM ('COLLECTED', 'FEATURED', 'DISCARDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "DemandSource" (
  "key"       TEXT PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "enabled"   BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "DemandClue" (
  "id"             TEXT PRIMARY KEY,
  "title"          TEXT NOT NULL,
  "summary"        TEXT NOT NULL,
  "keywords"       TEXT[] NOT NULL DEFAULT '{}',
  "status"         "ClueStatus" NOT NULL DEFAULT 'COLLECTED',
  "mentionCount"   INTEGER NOT NULL DEFAULT 0,
  "mentionerCount" INTEGER NOT NULL DEFAULT 0,
  "firstSeenAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "lastSeenAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "reviewedBy"     TEXT,
  "reviewedAt"     TIMESTAMPTZ,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "DemandClue_status_mentionerCount_idx" ON "DemandClue" ("status", "mentionerCount");
CREATE INDEX IF NOT EXISTS "DemandClue_status_mentionCount_idx" ON "DemandClue" ("status", "mentionCount");

CREATE TABLE IF NOT EXISTS "ClueMention" (
  "id"          TEXT PRIMARY KEY,
  "clueId"      TEXT NOT NULL REFERENCES "DemandClue"("id"),
  "sourceKey"   TEXT NOT NULL,
  "externalId"  TEXT NOT NULL,
  "authorKey"   TEXT NOT NULL,
  "url"         TEXT NOT NULL,
  "excerpt"     TEXT NOT NULL,
  "mentionedAt" TIMESTAMPTZ NOT NULL,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClueMention_sourceKey_externalId_key" ON "ClueMention" ("sourceKey", "externalId");
CREATE INDEX IF NOT EXISTS "ClueMention_clueId_idx" ON "ClueMention" ("clueId");

CREATE TABLE IF NOT EXISTS "CronState" (
  "key"       TEXT PRIMARY KEY,
  "lastRunAt" TIMESTAMPTZ NOT NULL
);
