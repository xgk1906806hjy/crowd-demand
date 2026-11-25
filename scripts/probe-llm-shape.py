#!/usr/bin/env python3
import importlib.util
import json
import urllib.request
import time

spec = importlib.util.spec_from_file_location("m", "/tmp/eval-clue-full.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

key, base, model = m.read_env("LLM_API_KEY"), m.read_env("LLM_BASE_URL"), m.read_env("LLM_MODEL")
items = m.load_items(10)
payload = [{"index": i, "title": x["title"], "excerpt": (x["excerpt"] or "")[:200]} for i, x in enumerate(items)]
for i, p in enumerate(payload):
    print(i, p["title"][:40])

for mt in (8000, 16000):
    body = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": m.OLD_PROMPT},
            {"role": "user", "content": json.dumps({"items": payload}, ensure_ascii=False)},
        ],
        "max_tokens": mt,
    }
    req = urllib.request.Request(
        base.rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "authorization": "Bearer " + key},
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            d = json.load(r)
        msg = d["choices"][0]["message"]
        print(
            f"\nmax_tokens={mt} 耗时{time.time()-t0:.1f}s finish={d['choices'][0].get('finish_reason')} "
            f"usage={d.get('usage')} content_len={len(msg.get('content') or '')} reasoning_len={len(msg.get('reasoning') or '')}"
        )
        print("head:", repr((msg.get("content") or msg.get("reasoning") or "")[:120]))
    except Exception as e:
        print(f"\nmax_tokens={mt} 失败 {type(e).__name__}: {e}")
