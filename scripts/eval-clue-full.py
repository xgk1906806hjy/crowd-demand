#!/usr/bin/env python3
"""全量候选评测：对比「旧提示词」与「新提示词（reason+score）」在线上真实候选上的保留率与样例。

用法（服务器）：
    python3 /tmp/eval-clue-full.py
"""
import json
import subprocess
import urllib.request

ENV_FILE = "/home/arzopa/apps/crowd-demand/deploy/.env.production"
DB = ["docker", "exec", "-i", "crowd-demand-db", "psql", "-U", "crowd", "-d", "crowd_demand", "-tAc"]


def read_env(key):
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            if line.startswith(key + "="):
                return line.strip().split("=", 1)[1].strip().strip('"')
    return ""


def load_items(limit=292):
    sql = (
        'select json_agg(t) from (select c.title, coalesce(c.summary, \'\') as excerpt, '
        'm."sourceKey" as source from "DemandClue" c '
        'join "ClueMention" m on m."clueId" = c.id group by c.title, c.summary, m."sourceKey" '
        f'order by random() limit {limit}) t'
    )
    out = subprocess.run(DB + [sql], capture_output=True, text=True).stdout.strip()
    return json.loads(out) if out else []


OLD_PROMPT = "\n".join([
    "你是需求线索审核员。输入是一批来自技术社区/问答区的候选条目（已脱敏）。",
    "判断标准只有一条：作者是否在表达缺少一款可复用的产品/工具/软件/服务/能力。",
    "算需求（示例）：求推荐 X 工具、有没有能做 Y 的软件、想找 Z 类服务、希望有个能自动处理某事的工具、愿意为某功能付费。",
    "不算需求（示例）：报错与异常排查、代码/算法实现求助、环境与安装配置、找学习资料/书籍/课程/教程、求学校或专业建议、",
    "对某个软件的具体操作提问、找人代做某件具体的事、作者介绍或分享自己做的项目、产品评测、行业资讯、招聘信息。",
    "若是需求，给出规范化中文标题：一律用简体中文（原文为英文请翻译），不超过 30 字，去掉营销词、广告词、emoji 与标题党修饰，保留具体场景与对象；",
    '只输出 JSON，格式：{"items":[{"index":0,"isDemand":true,"title":"……"}]}',
])

NEW_PROMPT = "\n".join([
    "你是需求线索审核员。输入是一批来自技术社区/问答区的候选条目（已脱敏）。",
    "",
    "对每一条，判断「作者是否在说：我缺一个可复用的产品/工具/软件/服务」。",
    "",
    "判 YES 必须同时满足：",
    "1) 作者本人在说自己的情况，不是转述、报道、评测别人；",
    "2) 缺的是一个可复用的东西（工具/软件/服务/功能/方案），不是一次性代码帮助或信息；",
    "3) 能说清「拿它做什么」。",
    "",
    "出现下列任一情况一律判 NO（即使含「求」「求助」「推荐」「有没有」）：",
    "- 盘点/清单/合集/排行榜/年度总结（XX 工具 Top10、必备软件清单、亲测六款）；",
    "- 资讯与发布消息（上线、融资、获奖、征文、名单公示）；",
    "- 教程/攻略/原理/源码解析/避坑指南；",
    "- 报错、异常、堆栈、环境配置、代码实现、算法题、debug；",
    "- 找学习资料（书、课程、视频、题解、认证）；",
    "- 学生作业、考试题、课设、毕设、代做代写；",
    "- 招聘、内推、简历、面经；",
    "- 个人情绪、生活琐事、与产品无关的观点讨论；",
    "- 只问某软件「怎么用」的具体操作问题。",
    "",
    "先查 NO 清单，命中即 NO；未命中再核对 YES 三条，缺一即 NO。拿不准判 NO。",
    "",
    "例外（避免误杀）：标题本身已是「求推荐/有没有/想找 + 具体工具品类」（App、软件、SDK、插件、引擎、框架、工具、服务），",
    "品类明确且不属于书/课程/资料/作业/招聘时，即使没写使用场景也判 YES，reason 写「缺XX类工具」。",
    "",
    "对每条判 YES 的，必须用 reason 说清「缺的是什么、用来干什么」，且能给出一句话说明使用场景；",
    "说不出来就说明它不是需求，应判 NO。",
    "",
    "参考示例：",
    "- 「求Wxid转微信号批量转换工具」→ YES，reason「缺批量转换微信ID的工具」",
    "- 「求一款免费的Web端PDF编辑JS库」→ YES，reason「缺免费 Web PDF 编辑库」",
    "- 「MAC 软件推荐，日常工作办公实用软件」→ NO（推介清单）",
    "- 「收藏！这份必备免费软件清单」→ NO（清单）",
    "- 「TRAE Work 实战帮征文 | 获奖名单公示」→ NO（活动公示）",
    "- 「求大家推荐一本linux书」→ NO（学习资料）",
    "",
    "输出严格 JSON：",
    '{"items":[{"index":0,"isDemand":true,"score":85,"reason":"缺XX工具，用于YY","title":"中文标题≤30字"},{"index":1,"isDemand":false}]}',
    "isDemand=false 不要给 title/reason/score。score 为 0-100 置信度。",
    "必须覆盖输入中的每一个 index，一条不漏：判 NO 的也要输出 index 与 isDemand:false，不要省略、不要合并。",
])


def call(prompt, batch, key, base, model, max_tokens=8000):
    body = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": json.dumps({"items": batch}, ensure_ascii=False)},
        ],
        "max_tokens": max_tokens,
    }
    req = urllib.request.Request(
        base.rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "authorization": "Bearer " + key},
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.load(r)
    msg = (data.get("choices") or [{}])[0].get("message") or {}
    text = (msg.get("content") or "").strip()
    if not text:
        # reasoning 模型偶发只吐思维链：重试一次，仍空则抛错由上层拆半
        raise RuntimeError(
            f"空响应 finish={data.get('choices',[{}])[0].get('finish_reason')} usage={data.get('usage')}"
        )
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    s, e = text.find("{"), text.rfind("}")
    obj = json.loads(text[s:e + 1])
    return {int(v["index"]): v for v in obj.get("items", []) if "index" in v}


def call_robust(prompt, payload, key, base, model, attempts=2):
    """返回 {相对 index: verdict}；空响应重试，仍失败则拆半递归。"""
    last = None
    for _ in range(attempts):
        try:
            return call(prompt, payload, key, base, model)
        except Exception as e:  # noqa: BLE001
            last = e
    if len(payload) > 1:
        mid = len(payload) // 2
        left = call_robust(prompt, payload[:mid], key, base, model, attempts)
        right_raw = call_robust(prompt, payload[mid:], key, base, model, attempts)
        # 右半的 index 是相对右半的，统一后移 mid
        merged = dict(left)
        for k, v in right_raw.items():
            v2 = dict(v)
            v2["index"] = k + mid
            merged[k + mid] = v2
        return merged
    raise RuntimeError(f"批次判定失败：{last}")


def run(items, prompt, key, base, model, batch_size, min_score, need_reason):
    kept = []
    for start in range(0, len(items), batch_size):
        chunk = items[start:start + batch_size]
        payload = [{"index": i, "title": x["title"], "excerpt": (x["excerpt"] or "")[:200]}
                   for i, x in enumerate(chunk)]
        try:
            verdicts = call_robust(prompt, payload, key, base, model)
        except Exception as e:  # noqa: BLE001
            print(f"    ! 批 {start}-{start+len(chunk)} 失败，跳过：{e}", flush=True)
            continue
        if len(verdicts) < len(chunk):
            print(f"    ! 批 {start} 仅返回 {len(verdicts)}/{len(chunk)} 条判定", flush=True)
        for i, x in enumerate(chunk):
            v = verdicts.get(i, {})
            ok = bool(v.get("isDemand"))
            if ok and min_score:
                ok = int(v.get("score") or 0) >= min_score
            if ok and need_reason:
                ok = bool((v.get("reason") or "").strip())
            if ok:
                kept.append({"title": x["title"], "source": x.get("source"), "reason": v.get("reason"),
                             "score": v.get("score")})
    return kept


def main():
    key, base, model = read_env("LLM_API_KEY"), read_env("LLM_BASE_URL"), read_env("LLM_MODEL")
    items = load_items()
    print(f"候选 {len(items)} 条，模型 {model}", flush=True)

    old_kept = run(items, OLD_PROMPT, key, base, model, 10, 0, False)
    print(f"\n[旧提示词 10条/批] 保留 {len(old_kept)}/{len(items)} = {len(old_kept)/max(len(items),1):.0%}", flush=True)
    for r in old_kept[:12]:
        print("   +", r["title"][:40], flush=True)

    new_kept = run(items, NEW_PROMPT, key, base, model, 10, 75, True)
    print(f"\n[新提示词 10条/批 score>=75+reason] 保留 {len(new_kept)}/{len(items)} = {len(new_kept)/max(len(items),1):.0%}", flush=True)
    for r in new_kept[:30]:
        print(f"   + [{r['source']}] {r['title'][:38]} | {str(r['reason'])[:24]} | {r['score']}", flush=True)

    old_titles = {r["title"] for r in old_kept}
    new_titles = {r["title"] for r in new_kept}
    print(f"\n交集 {len(old_titles & new_titles)}；仅旧版 {len(old_titles - new_titles)}；仅新版 {len(new_titles - old_titles)}", flush=True)


if __name__ == "__main__":
    main()
