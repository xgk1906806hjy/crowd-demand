-- F29 v0.4 移除演示数据源：清空 mock 来源的提及、孤儿线索与来源记录
-- 幂等：可重复执行。执行前建议先 pg_dump 备份。
BEGIN;

DELETE FROM "ClueMention" WHERE "sourceKey" = 'mock';

-- 删除因上一步而失去任何提及的线索（mock 线索聚合出的记录）
DELETE FROM "DemandClue"
WHERE id NOT IN (SELECT DISTINCT "clueId" FROM "ClueMention");

DELETE FROM "DemandSource" WHERE key = 'mock';

COMMIT;
