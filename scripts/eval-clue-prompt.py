#!/usr/bin/env python3
"""提示词 A/B 评测：用线上人工可判的样本，比较新旧提示词的判定准确率。

用法（在服务器上）：
    python3 /tmp/eval-clue-prompt.py

依赖：库内已有线索、deploy/.env.production 中的 LLM_* 配置。
"""
import json
import subprocess
import urllib.request
import urllib.error

ENV_FILE = "/home/arzopa/apps/crowd-demand/deploy/.env.production"
DB = ["docker", "exec", "-i", "crowd-demand-db", "psql", "-U", "crowd", "-d", "crowd_demand", "-tAc"]


def read_env(key):
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            if line.startswith(key + "="):
                return line.strip().split("=", 1)[1].strip().strip('"')
    return ""


GOOD = [
    "求Wxid转微信号批量转换工具",
    "求Mac上类似dstat的系统监控工具",
    "求一款免费的Web端PDF编辑JS库",
    "求电影票自动出票平台",
    "PC端网络实时抓包软件推荐",
    "求推荐免费远程拨测软件",
    "求推荐防火墙自动化开墙工具",
    "悬赏定制硬件的网站",
    "求类似PhET的开源物理仿真软件",
    "求推荐原型设计生成前端代码的工具",
]

BAD = [
    "MAC 软件推荐，日常工作办公实用软件",
    "微信上线AI帮写，朋友圈文案不用自己憋了",
    "TRAE Work 实战帮征文 | 获奖名单公示",
    "量子计算机不同时测试所有解",
    "你以为OpenClaw在帮你赚钱？其实它是在赚你的钱",
    "收藏！这份必备免费软件清单，让你的 Mac 更值钱 | 有用功",
    "我想我不喜欢旅行",
    "为什么bfcache未在互联网上广泛实现？",
    "超实用的两款截图工具（FastStone Capture 和 Snipaste）",
    "2019自动化测试工具Top10",
]


def load_samples():
    titles = GOOD + BAD
    quoted = ",".join("'" + t.replace("'", "''") + "'" for t in titles)
    sql = (
        'select json_agg(t) from (select title, coalesce(summary, \'\') as excerpt '
        f'from "DemandClue" where title in ({quoted})) t'
    )
    out = subprocess.run(DB + [sql], capture_output=True, text=True).stdout.strip()
    if not out:
        return []
    rows = json.loads(out)
    by_title = {r["title"]: r for r in rows}
    samples = []
    for t in GOOD:
        if t in by_title:
            samples.append({"title": t, "excerpt": by_title[t]["excerpt"], "label": True})
    for t in BAD:
        if t in by_title:
            samples.append({"title": t, "excerpt": by_title[t]["excerpt"], "label": False})
    return samples


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
    "判 YES（isDemand=true）必须同时满足三条：",
    "1) 是作者本人在说自己的情况，不是转述、报道、评测别人；",
    "2) 缺的是一个可复用的东西（工具/软件/服务/功能/方案），不是一次性的代码帮助或信息；",
    "3) 能给出一句话说明「拿它做什么」，不是泛泛感慨。",
    "",
    "出现下列任一情况，一律判 NO，即使含「求」「求助」「推荐」「有没有」「痛点」等字眼：",
    "- 盘点/清单/合集/排行榜/年度总结，如「XX 工具 Top10」「必备软件清单」「亲测六款」；",
    "- 资讯与发布消息：某产品上线、融资、获奖、征文、名单公示；",
    "- 教程/攻略/原理/源码解析/避坑指南；",
    "- 报错、异常、堆栈、环境配置、代码实现、算法题、debug；",
    "- 找学习资料：书、课程、视频、题解、认证；",
    "- 学生作业、考试题、课设、毕设、代做代写；",
    "- 招聘、内推、简历、面经；",
    "- 个人情绪、生活琐事、与产品无关的观点讨论；",
    "- 只问某个软件「怎么用」的具体操作问题。",
    "",
    "判断顺序：先看是否命中任一 NO 情形；命中即 NO。未命中再核对三条 YES；有一条不满足即 NO。",
    "拿不准一律判 NO（宁可漏，不可错）。",
    "",
    "参考示例（真实样本）：",
    "- 「求Wxid转微信号批量转换工具」→ YES（明确工具缺口 + 场景）",
    "- 「求一款免费的Web端PDF编辑JS库」→ YES",
    "- 「求类似PhET的开源物理仿真软件」→ YES",
    "- 「MAC 软件推荐，日常工作办公实用软件」→ NO（推介清单）",
    "- 「Google发布浏览器自动化工具Puppeteer 1.0」→ NO（发布消息）",
    "- 「TRAE Work 实战帮征文 | 获奖名单公示」→ NO（活动公示）",
    "- 「收藏！这份必备免费软件清单，让你的 Mac 更值钱」→ NO（清单）",
    "- 「我想我不喜欢旅行」→ NO（情绪）",
    "- 「量子计算机不同时测试所有解」→ NO（观点）",
    "- 「求大家推荐一本linux书」→ NO（学习资料）",
    "",
    "输出严格 JSON，不要多余文字：",
    '{"items":[{"index":0,"isDemand":true,"score":85,"title":"中文标题，≤30字，去营销词"},{"index":1,"isDemand":false}]}',
    "isDemand=false 时不要给 title 和 score；score 为 0-100 的置信度。",
])


def judge(prompt, batch, api_key, base_url, model):
    body = {
        "model": model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": json.dumps({"items": batch}, ensure_ascii=False)},
        ],
        "max_tokens": 4000,
    }
    req = urllib.request.Request(
        base_url.rstrip("/") + "/chat/completions",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "authorization": "Bearer " + api_key},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.load(r)
    text = data["choices"][0]["message"]["content"].strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    parsed = json.loads(text[start:end + 1])
    return {int(v["index"]): v for v in parsed.get("items", []) if "index" in v}


def evaluate(samples, prompt, api_key, base_url, model, min_score):
    payload = [{"index": i, "title": s["title"], "excerpt": (s["excerpt"] or "")[:200]}
               for i, s in enumerate(samples)]
    verdicts = judge(prompt, payload, api_key, base_url, model)
    results = []
    for i, s in enumerate(samples):
        v = verdicts.get(i, {})
        keep = bool(v.get("isDemand")) and int(v.get("score") or 100) >= min_score
        results.append({"title": s["title"], "label": s["label"], "keep": keep, "score": v.get("score")})
    return results


def report(name, results):
    tp = sum(1 for r in results if r["label"] and r["keep"])
    fn = sum(1 for r in results if r["label"] and not r["keep"])
    fp = sum(1 for r in results if not r["label"] and r["keep"])
    tn = sum(1 for r in results if not r["label"] and not r["keep"])
    print(f"[{name}] 真需求保留 {tp}/10，真需求漏判 {fn}，噪声误收 {fp}/10，噪声正确剔除 {tn}/10")
    for r in results:
        if (r["label"] and not r["keep"]) or ((not r["label"]) and r["keep"]):
            tag = "漏判真需求" if r["label"] else "误收噪声"
            print(f"   - {tag}: {r['title'][:40]} (score={r['score']})")
    return tp, fp


def load_fillers(exclude, limit):
    quoted = ",".join("'" + t.replace("'", "''") + "'" for t in exclude)
    sql = (
        'select json_agg(t) from (select title, coalesce(summary, \'\') as excerpt '
        f'from "DemandClue" where title not in ({quoted}) order by random() limit {limit}) t'
    )
    out = subprocess.run(DB + [sql], capture_output=True, text=True).stdout.strip()
    if not out:
        return []
    return [{"title": r["title"], "excerpt": r["excerpt"], "label": None} for r in json.loads(out)]


def evaluate_mixed(samples, prompt, api_key, base_url, model, min_score, batch_size, label):
    """把标注样本与随机干扰条目混成一批，模拟线上 40 条/批的真实条件。"""
    fillers = load_fillers([s["title"] for s in samples], max(batch_size - len(samples), 0))
    pool = samples + fillers
    results = []
    for start in range(0, len(pool), batch_size):
        chunk = pool[start:start + batch_size]
        payload = [{"index": i, "title": s["title"], "excerpt": (s["excerpt"] or "")[:200]}
                   for i, s in enumerate(chunk)]
        verdicts = judge(prompt, payload, api_key, base_url, model)
        for i, s in enumerate(chunk):
            if s["label"] is None:
                continue
            v = verdicts.get(i, {})
            keep = bool(v.get("isDemand")) and int(v.get("score") or 100) >= min_score
            results.append({"title": s["title"], "label": s["label"], "keep": keep, "score": v.get("score")})
    return results


def main():
    api_key = read_env("LLM_API_KEY")
    base_url = read_env("LLM_BASE_URL")
    model = read_env("LLM_MODEL")
    samples = load_samples()
    if not samples:
        print("库内没有匹配样本，先跑一次采集")
        return
    print(f"样本 {len(samples)} 条（真需求 10 / 噪声 10），模型 {model}")

    print("\n== 单独判定 ==")
    report("旧提示词", evaluate(samples, OLD_PROMPT, api_key, base_url, model, 0))
    report("新提示词(score>=75)", evaluate(samples, NEW_PROMPT, api_key, base_url, model, 75))

    print("\n== 混合 40 条干扰（模拟线上单批）==")
    report("旧提示词/40条批", evaluate_mixed(samples, OLD_PROMPT, api_key, base_url, model, 0, 40, "old40"))
    report("新提示词/40条批", evaluate_mixed(samples, NEW_PROMPT, api_key, base_url, model, 75, 40, "new40"))

    print("\n== 混合 20 条干扰 ==")
    report("旧提示词/20条批", evaluate_mixed(samples, OLD_PROMPT, api_key, base_url, model, 0, 20, "old20"))
    report("新提示词/20条批", evaluate_mixed(samples, NEW_PROMPT, api_key, base_url, model, 75, 20, "new20"))


if __name__ == "__main__":
    main()


if __name__ == "__main__":
    main()
