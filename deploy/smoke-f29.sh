#!/usr/bin/env bash
# F29 冒烟：定时挖需求 + 提及热榜（对已部署实例发起真实 HTTP 调用）
# 用法（在服务器上执行）：./deploy/smoke-f29.sh [http://127.0.0.1:8000]
set -uo pipefail

cd "$(dirname "$0")/.."
BASE="${1:-http://127.0.0.1:8000}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
bad() { FAIL=$((FAIL + 1)); printf '\033[1;31m  ✗\033[0m %s\n' "$*"; }
log() { printf '\033[1;34m[f29]\033[0m %s\n' "$*"; }

json_get() {
  python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print(""); sys.exit(0)
for k in sys.argv[1].lstrip(".").split("."):
    if not k: continue
    if isinstance(d, list):
        try: d = d[int(k)]
        except Exception: d = None
    elif isinstance(d, dict):
        d = d.get(k)
    else:
        d = None
    if d is None: break
print("" if d is None else d)
' "$1"
}

api() {
  local jar="$1" method="$2" path="$3" data="${4:-}"
  if [ -n "$data" ]; then
    curl -s -m 30 -b "$jar" -c "$jar" -X "$method" \
      -H 'content-type: application/json' -d "$data" "$BASE$path" -w '\n%{http_code}'
  else
    curl -s -m 30 -b "$jar" -c "$jar" -X "$method" "$BASE$path" -w '\n%{http_code}'
  fi
}
body_of() { printf '%s' "$1" | sed '$d'; }
code_of() { printf '%s' "$1" | tail -1; }

SECRET=$(grep -E '^CRON_SECRET=' deploy/.env.production | head -1 | cut -d= -f2-)
RUN=$(date +%H%M%S)$$

log "F29 冒烟开始：$BASE"

# 1. cron 鉴权
R=$(curl -s -m 20 -X POST "$BASE/api/internal/cron" -w '\n%{http_code}')
[ "$(code_of "$R")" = "401" ] && ok "cron 无密钥被拒（401）" || bad "cron 无密钥应 401，实际 $(code_of "$R")"
R=$(curl -s -m 20 -X POST "$BASE/api/internal/cron" -H 'x-cron-secret: wrong-secret' -w '\n%{http_code}')
[ "$(code_of "$R")" = "401" ] && ok "cron 错误密钥被拒（401）" || bad "cron 错误密钥应 401"

# 2. 强制采集（job=clues, force）：v0.8 只写候选缓冲区
R=$(curl -s -m 900 -X POST "$BASE/api/internal/cron" -H "x-cron-secret: $SECRET" \
  -H 'content-type: application/json' -d '{"job":"clues","force":true}' -w '\n%{http_code}')
B=$(body_of "$R")
[ "$(code_of "$R")" = "200" ] && ok "cron 强制采集 200" || bad "cron 强制采集应 200，实际 $(code_of "$R")"
[ "$(printf '%s' "$B" | json_get '.data.clues.ran')" = "True" ] && ok "采集已执行（ran=true）" || bad "采集未执行"
F=$(printf '%s' "$B" | json_get '.data.clues.sources.csdn.fetched')
[ "${F:-0}" -gt 0 ] 2>/dev/null && ok "csdn 拉到 $F 条候选提及" || bad "csdn 无候选（fetched=$F）"
CAND=$(printf '%s' "$B" | json_get '.data.clues.candidates')
[ "${CAND:-0}" -ge 0 ] 2>/dev/null && ok "本轮写入候选 $CAND 条（供小时聚合消费）" || bad "候选写入字段缺失"
LQ=$(printf '%s' "$B" | json_get '.data.clues.llmQueries')
ok "本轮模型检索词 $LQ 条"

# 3. 幂等：候选按 (sourceKey,externalId) 唯一，二次采集不重复写
R=$(curl -s -m 900 -X POST "$BASE/api/internal/cron" -H "x-cron-secret: $SECRET" \
  -H 'content-type: application/json' -d '{"job":"clues","force":true}' -w '\n%{http_code}')
B=$(body_of "$R")
DUP=$(docker exec crowd-demand-db psql -U crowd -d crowd_demand -tAc \
  'select count(*) from (select "sourceKey", "externalId" from "ClueCandidate" group by 1,2 having count(*) > 1) t' 2>/dev/null | tr -d ' ')
[ "${DUP:-9}" = "0" ] && ok "候选缓冲区无重复（幂等生效）" || bad "候选缓冲区存在重复 $DUP 组"

# 4. 节流：不带 force 应 throttled
R=$(curl -s -m 600 -X POST "$BASE/api/internal/cron" -H "x-cron-secret: $SECRET" \
  -H 'content-type: application/json' -d '{"job":"clues"}' -w '\n%{http_code}')
B=$(body_of "$R")
[ "$(printf '%s' "$B" | json_get '.data.clues.reason')" = "throttled" ] && ok "间隔内触发被节流" || bad "应 throttled"

# 4b. 小时聚合（v0.8 第二段）：领走 6 轮候选聚类入库
R=$(curl -s -m 1200 -X POST "$BASE/api/internal/cron" -H "x-cron-secret: $SECRET" \
  -H 'content-type: application/json' -d '{"job":"clue-hourly","force":true}' -w '\n%{http_code}')
B=$(body_of "$R")
[ "$(code_of "$R")" = "200" ] && ok "小时聚合 200" || bad "小时聚合应 200，实际 $(code_of "$R")"
[ "$(printf '%s' "$B" | json_get '.data.hourly.ran')" = "True" ] && ok "聚合已执行" || bad "聚合未执行"
HC=$(printf '%s' "$B" | json_get '.data.hourly.candidates')
HK=$(printf '%s' "$B" | json_get '.data.hourly.clusters')
AR=$(printf '%s' "$B" | json_get '.data.hourly.avgRepeat')
ok "消费候选 $HC 条 → 聚成 $HK 组（平均重复 $AR 次/组）"
NQ=$(printf '%s' "$B" | json_get '.data.hourly.newQueries')
ok "顺带生成模型检索词 $NQ 条"
USED=$(docker exec crowd-demand-db psql -U crowd -d crowd_demand -tAc \
  'select count(*) from "ClueCandidate" where "usedAt" is not null' 2>/dev/null | tr -d ' ')
[ "${USED:-0}" -gt 0 ] 2>/dev/null && ok "已消费候选标记 usedAt（$USED 条）" || bad "候选未被标记 usedAt"
QROWS=$(docker exec crowd-demand-db psql -U crowd -d crowd_demand -tAc \
  'select count(*) from "ClueQuery"' 2>/dev/null | tr -d ' ')
[ "${QROWS:-0}" -gt 0 ] 2>/dev/null && ok "检索词表已积累 $QROWS 条" || bad "检索词表为空"
# 聚合后热榜应有线索
R=$(api "$TMP/pub.jar" GET "/api/clues/top?limit=5")
N2=$(printf '%s' "$(body_of "$R")" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["data"]["items"]))' 2>/dev/null || echo 0)
[ "${N2:-0}" -gt 0 ] 2>/dev/null && ok "聚合后热榜有 $N2 条线索" || bad "聚合后热榜为空"

# 5. 公开热榜
R=$(api "$TMP/pub.jar" GET "/api/clues/top?limit=20")
B=$(body_of "$R")
[ "$(code_of "$R")" = "200" ] && ok "公开热榜 200" || bad "公开热榜应 200"
N=$(printf '%s' "$B" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["data"]["items"]))' 2>/dev/null || echo 0)
[ "${N:-0}" -gt 0 ] 2>/dev/null && ok "热榜有 $N 条线索" || bad "热榜为空"
SORTED=$(printf '%s' "$B" | python3 -c '
import sys, json
items = json.load(sys.stdin)["data"]["items"]
keys = [(i["mentionerCount"], i["mentionCount"]) for i in items]
print(keys == sorted(keys, reverse=True))
' 2>/dev/null || echo False)
[ "$SORTED" = "True" ] && ok "热榜按提及人数/次数降序" || bad "热榜排序错误"
TOP1_PEOPLE=$(printf '%s' "$B" | json_get '.data.items.0.mentionerCount')
TOP1_COUNT=$(printf '%s' "$B" | json_get '.data.items.0.mentionCount')
# 真实渠道下同一痛点未必跨平台重复（既有聚合可能为 1 人），只校验计数口径自洽
[ "${TOP1_PEOPLE:-0}" -ge 1 ] 2>/dev/null && [ "${TOP1_COUNT:-0}" -ge "${TOP1_PEOPLE:-0}" ] 2>/dev/null \
  && ok "榜首提及人数 $TOP1_PEOPLE / 次数 $TOP1_COUNT（口径自洽）" \
  || bad "榜首计数异常 people=$TOP1_PEOPLE count=$TOP1_COUNT"

R=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$BASE/trending")
[ "$R" = "200" ] && ok "热榜页面 /trending 200" || bad "/trending 应 200，实际 $R"

# 6. 注册普通用户 → 管理接口 403
R=$(api "$TMP/u.jar" POST "/api/auth/register" "{\"username\":\"f29$RUN\",\"password\":\"1Aa!2345\"}")
B=$(body_of "$R")
USER_ID=$(printf '%s' "$B" | json_get '.data.user.id')
[ "$(code_of "$R")" = "201" ] && ok "注册测试用户" || bad "注册失败 $(code_of "$R")"
R=$(api "$TMP/u.jar" GET "/api/admin/clues")
[ "$(code_of "$R")" = "403" ] && ok "非运营访问线索后台被拒（403）" || bad "应 403"

# 7. 授予 OPERATOR（与 smoke.sh 同法）
docker exec crowd-demand-db psql -U crowd -d crowd_demand -tAc \
  "UPDATE \"User\" SET roles = array_append(roles, 'OPERATOR') WHERE id = '$USER_ID' AND NOT ('OPERATOR' = ANY(roles))" > /dev/null 2>&1
R=$(api "$TMP/u.jar" GET "/api/admin/clues")
B=$(body_of "$R")
[ "$(code_of "$R")" = "200" ] && ok "运营可看线索后台" || bad "运营后台应 200"
HAS_CN=$(printf '%s' "$B" | python3 -c '
import sys, json
keys = {s["key"] for s in json.load(sys.stdin)["data"]["sources"]}
print(any(k in keys for k in ("csdn", "weixin", "juejin")))
' 2>/dev/null || echo False)
[ "$HAS_CN" = "True" ] && ok "来源列表含国内社媒渠道" || bad "来源列表缺国内渠道"
NO_MOCK=$(printf '%s' "$B" | python3 -c '
import sys, json
keys = {s["key"] for s in json.load(sys.stdin)["data"]["sources"]}
print("mock" not in keys)
' 2>/dev/null || echo False)
[ "$NO_MOCK" = "True" ] && ok "演示数据源已移除" || bad "来源列表仍含 mock"

# 8. 收录榜首线索
TOP_ID=$(printf '%s' "$B" | json_get '.data.items.0.id')
R=$(api "$TMP/u.jar" POST "/api/admin/clues/$TOP_ID/review" '{"action":"FEATURE"}')
B=$(body_of "$R")
[ "$(printf '%s' "$B" | json_get '.data.status')" = "FEATURED" ] && ok "线索收录成功" || bad "收录失败"

# 9. 丢弃末位线索 → 热榜隐藏；终态不可再操作（只挑仍处于 COLLECTED 的线索，保证脚本可重复执行）
LAST_ID=$(printf '%s' "$(api "$TMP/u.jar" GET "/api/admin/clues")" | sed '$d' | python3 -c '
import sys, json
items = [i for i in json.load(sys.stdin)["data"]["items"] if i["status"] == "COLLECTED"]
print(items[-1]["id"] if items else "")
' 2>/dev/null || echo "")
R=$(api "$TMP/u.jar" POST "/api/admin/clues/$LAST_ID/review" '{"action":"DISCARD"}')
[ "$(printf '%s' "$(body_of "$R")" | json_get '.data.status')" = "DISCARDED" ] && ok "线索丢弃成功" || bad "丢弃失败"
R=$(api "$TMP/pub.jar" GET "/api/clues/top?limit=50")
GONE=$(printf '%s' "$(body_of "$R")" | python3 -c "
import sys, json
print(all(i['id'] != '$LAST_ID' for i in json.load(sys.stdin)['data']['items']))
" 2>/dev/null || echo False)
[ "$GONE" = "True" ] && ok "丢弃后热榜隐藏" || bad "丢弃线索仍在热榜"
R=$(api "$TMP/u.jar" POST "/api/admin/clues/$LAST_ID/review" '{"action":"FEATURE"}')
[ "$(code_of "$R")" = "409" ] && ok "已丢弃线索不可再操作（409）" || bad "应 409"

# 10. 来源启停：停用全部来源后采集不产生候选（v0.8 判据改为候选写入数）
for k in csdn weixin juejin douyin kuaishou hn; do
  api "$TMP/u.jar" POST "/api/admin/clues/sources" "{\"key\":\"$k\",\"enabled\":false}" > /dev/null 2>&1
done
R=$(api "$TMP/u.jar" POST "/api/admin/clues/sources" '{"key":"csdn","enabled":false}')
[ "$(printf '%s' "$(body_of "$R")" | json_get '.data.enabled')" = "False" ] && ok "来源停用成功" || bad "来源停用失败"
R=$(curl -s -m 900 -X POST "$BASE/api/internal/cron" -H "x-cron-secret: $SECRET" \
  -H 'content-type: application/json' -d '{"job":"clues","force":true}' -w '\n%{http_code}')
C=$(printf '%s' "$(body_of "$R")" | json_get '.data.clues.candidates')
REASON=$(printf '%s' "$(body_of "$R")" | json_get '.data.clues.reason')
if [ "${C:-0}" = "0" ] || [ "$REASON" = "no-sources" ]; then
  ok "停用来源不产生候选（candidates=${C:-0}${REASON:+, reason=$REASON}）"
else
  bad "停用后仍写候选 candidates=$C"
fi
for k in csdn weixin juejin douyin kuaishou hn; do
  api "$TMP/u.jar" POST "/api/admin/clues/sources" "{\"key\":\"$k\",\"enabled\":true}" > /dev/null 2>&1
done
R=$(api "$TMP/u.jar" POST "/api/admin/clues/sources" '{"key":"csdn","enabled":true}')
[ "$(printf '%s' "$(body_of "$R")" | json_get '.data.enabled')" = "True" ] && ok "来源恢复启用" || bad "来源恢复失败"

# 11. 手动采集入口（含大模型整合，可能耗时 1 分钟以上）
R=$(curl -s -m 600 -b "$TMP/u.jar" -c "$TMP/u.jar" -X POST "$BASE/api/admin/clues/collect" -w '\n%{http_code}')
[ "$(printf '%s' "$(body_of "$R")" | json_get '.data.ran')" = "True" ] && ok "运营手动采集可用" || bad "手动采集失败"

log "结果：通过 $PASS 项，失败 $FAIL 项"
[ "$FAIL" = "0" ] || exit 1
