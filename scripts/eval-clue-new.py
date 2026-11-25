#!/usr/bin/env python3
"""只用「新提示词（v0.7）」判定全量候选，输出保留率与样例，供人工核对质量。

用法（服务器）：python3 /tmp/eval-new.py [并发数]
"""
import importlib.util
import json
import sys
from concurrent.futures import ThreadPoolExecutor

spec = importlib.util.spec_from_file_location("m", "/tmp/eval-clue-full.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

CONCURRENCY = int(sys.argv[1]) if len(sys.argv) > 1 else 4
BATCH = 10
MIN_SCORE = 75


def judge_chunk(args):
    chunk = args
    payload = [{"index": i, "title": x["title"], "excerpt": (x["excerpt"] or "")[:200]}
               for i, x in enumerate(chunk)]
    verdicts = m.call_robust(m.NEW_PROMPT, payload, KEY, BASE, MODEL)
    rows = []
    for i, x in enumerate(chunk):
        v = verdicts.get(i)
        if not v:
            rows.append((x, "MISSING", None, None))
            continue
        if not v.get("isDemand"):
            rows.append((x, "NO", None, None))
            continue
        score = int(v.get("score") or 0)
        reason = (v.get("reason") or "").strip()
        if score < MIN_SCORE:
            rows.append((x, "LOW", score, reason))
        elif not reason:
            rows.append((x, "NOREASON", score, reason))
        else:
            rows.append((x, "KEEP", score, reason))
    return rows


KEY, BASE, MODEL = m.read_env("LLM_API_KEY"), m.read_env("LLM_BASE_URL"), m.read_env("LLM_MODEL")
items = m.load_items(400)
print(f"候选 {len(items)} 条，模型 {MODEL}，并发 {CONCURRENCY}，批 {BATCH}", flush=True)

chunks = [items[i:i + BATCH] for i in range(0, len(items), BATCH)]
all_rows = []
with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
    for rows in ex.map(judge_chunk, chunks):
        all_rows.extend(rows)

stats = {}
for _, kind, _, _ in all_rows:
    stats[kind] = stats.get(kind, 0) + 1
total = len(all_rows)
print("\n判定分布：", stats, f"合计 {total}", flush=True)
keep = [r for r in all_rows if r[1] == "KEEP"]
print(f"保留率 {len(keep)}/{total} = {len(keep)/max(total,1):.0%}", flush=True)

print("\n=== 保留样例（前 40）===", flush=True)
for x, _, score, reason in keep[:40]:
    print(f"[{x.get('source')}] {x['title'][:44]} | {score} | {reason[:26]}", flush=True)

print("\n=== 判 NO 的样例（前 25，人工核对是否误杀）===", flush=True)
for x, kind, _, _ in [r for r in all_rows if r[1] != "KEEP"][:25]:
    print(f"[{kind}][{x.get('source')}] {x['title'][:48]}", flush=True)
