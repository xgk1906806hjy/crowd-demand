#!/usr/bin/env python3
"""幂等设置 F29 v0.8 相关环境变量（保留其余行与注释，不打印敏感值）。"""
import re
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else "deploy/.env.production"
DESIRED = [
    ("CLUE_SOURCES", "csdn,weixin,juejin,douyin,kuaishou,hn"),
    ("CLUE_INGEST_INTERVAL_MIN", "10"),
    ("CLUE_ANALYZE_INTERVAL_MIN", "60"),
    ("CLUE_ANALYZE_MAX_ITEMS", "200"),
    ("CLUE_ROUND_INGEST", "false"),
]

lines = open(PATH, encoding="utf-8").read().splitlines()
keys = {k for k, _ in DESIRED}
seen = set()
out = []
for line in lines:
    m = re.match(r"^(?:#\s*)?([A-Z0-9_]+)=", line)
    if m and m.group(1) in keys:
        key = m.group(1)
        if key in seen:
            continue
        value = dict(DESIRED)[key]
        out.append(f"{key}={value}")
        seen.add(key)
    else:
        out.append(line)
missing = [(k, v) for k, v in DESIRED if k not in seen]
if missing:
    out.append("")
    out.append("# F29 v0.8 两段式：每 10 分钟采集写候选，每小时聚合分析入库")
    for k, v in missing:
        out.append(f"{k}={v}")

open(PATH, "w", encoding="utf-8").write("\n".join(out).rstrip() + "\n")

print("updated keys:", ", ".join(k for k, _ in DESIRED))
print("douyin/kuaishou in sources:", "douyin" in dict(DESIRED)["CLUE_SOURCES"])
