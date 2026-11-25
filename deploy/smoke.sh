#!/usr/bin/env bash
# 端到端冒烟测试：对已部署实例发起真实 HTTP 调用，走完整业务链路
#   注册登录 → 实名 → 发需求 → 投票 → 付费承诺 → 竞标 → 提案 → 选标 → 交付 → 验收
#
# 用法（在服务器上执行，需能访问 docker compose 以读取 Mock 短信验证码）：
#   ./deploy/smoke.sh                       # 默认 http://127.0.0.1:8000
#   ./deploy/smoke.sh http://192.168.100.91:8000
#
# 说明：Mock 短信把验证码打印在应用日志里，脚本从日志读取，因此必须在部署机执行。
set -uo pipefail

cd "$(dirname "$0")/.."
BASE="${1:-http://127.0.0.1:8000}"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file deploy/.env.production"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
log()  { printf '\033[1;34m[smoke]\033[0m %s\n' "$*"; }
ok()   { PASS=$((PASS + 1)); printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
bad()  { FAIL=$((FAIL + 1)); printf '\033[1;31m  ✗\033[0m %s\n' "$*"; }

# 从 JSON 取嵌套字段，如 json_get '.data.id'
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

# api <jar> <method> <path> [json]
api() {
  local jar="$1" method="$2" path="$3" data="${4:-}"
  if [ -n "$data" ]; then
    curl -s -m 25 -b "$jar" -c "$jar" -X "$method" \
      -H 'content-type: application/json' -d "$data" "$BASE$path" \
      -w '\n%{http_code}'
  else
    curl -s -m 25 -b "$jar" -c "$jar" -X "$method" "$BASE$path" -w '\n%{http_code}'
  fi
}

# 拆分 body 与 status code
body_of() { printf '%s' "$1" | sed '$d'; }
code_of() { printf '%s' "$1" | tail -1; }

# 断言：HTTP 200 且 data 非空
assert_ok() {
  local label="$1" resp="$2"
  local code; code=$(code_of "$resp")
  if [ "$code" = "200" ]; then ok "$label"; else
    bad "$label（HTTP $code：$(body_of "$resp" | head -c 200)）"
  fi
}

# 取 Mock 验证码
mock_code() {
  local phone="$1" code=""
  for _ in $(seq 1 10); do
    code=$($COMPOSE logs --tail=120 app 2>/dev/null \
      | grep "\[MockSMS\] to=$phone" | tail -1 \
      | sed -n 's/.*code=\([0-9]\{6\}\).*/\1/p')
    [ -n "$code" ] && break
    sleep 1
  done
  printf '%s' "$code"
}

# 生成合法身份证号（GB 11643 校验码），body 为前 17 位
gen_idnum() {
  python3 -c '
import sys
body = sys.argv[1]
w = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]
m = "10X98765432"
print(body + m[sum(int(c) * wi for c, wi in zip(body, w)) % 11])
' "$1"
}

# 注册/登录一个用户：register_user <昵称标识> <手机号> <jar>
register_user() {
  local tag="$1" phone="$2" jar="$3" resp code
  resp=$(api "$jar" POST /api/auth/send-code "{\"phone\":\"$phone\"}")
  assert_ok "发送验证码（$tag）" "$resp" >&2

  code=$(mock_code "$phone")
  if [ -z "$code" ]; then bad "读取 Mock 验证码（$tag）"; return 1; fi

  resp=$(api "$jar" POST /api/auth/verify "{\"phone\":\"$phone\",\"code\":\"$code\"}")
  assert_ok "登录（$tag）" "$resp" >&2
  return 0
}

# 实名认证（Mock：姓名不含「拒绝」即通过）
verify_kyc() {
  local tag="$1" jar="$2" idnum="$3" resp
  resp=$(api "$jar" POST /api/kyc/submit "{\"realName\":\"$tag\",\"idNumber\":\"$idnum\"}")
  assert_ok "实名认证（$tag）" "$resp"
}

log "目标地址：$BASE"
RUN=$(date +%s | rev | cut -c1-8 | rev)   # 8 位，用于手机号后 8 位与幂等键
PHONE_A="139$RUN"   # 发起者（后续提权为运营，驱动状态流转）
PHONE_B="138$RUN"   # 支持者
PHONE_C="137$RUN"   # 开发者
# 身份证号需全局唯一（kycIdNumberHash @unique），用运行时间派生顺序码，避免重跑冲突
SEQ=$((10#${RUN:5:3} % 900 + 100))
IDNUM_A=$(gen_idnum "11010519900307$SEQ")
IDNUM_B=$(gen_idnum "31010119880512$SEQ")
IDNUM_C=$(gen_idnum "44030519951212$SEQ")

# ---------- 0. 健康检查 ----------
resp=$(curl -s -m 15 "$BASE/api/health" -w '\n%{http_code}')
assert_ok "健康检查" "$resp"
DB_STATE=$(body_of "$resp" | json_get '.db')
[ "$DB_STATE" = "up" ] && ok "数据库连通" || bad "数据库状态：$DB_STATE"

# ---------- 1. 注册三个角色 ----------
JAR_A="$TMP/a.jar"; JAR_B="$TMP/b.jar"; JAR_C="$TMP/c.jar"
register_user "发起者" "$PHONE_A" "$JAR_A" || exit 1
register_user "支持者" "$PHONE_B" "$JAR_B" || exit 1
register_user "开发者" "$PHONE_C" "$JAR_C" || exit 1

resp=$(api "$JAR_A" GET /api/auth/me)
UID_A=$(body_of "$resp" | json_get '.data.id')
[ -n "$UID_A" ] && ok "会话有效（userId=$UID_A）" || bad "获取当前用户失败"

verify_kyc "张三" "$JAR_A" "$IDNUM_A"
verify_kyc "李四" "$JAR_B" "$IDNUM_B"
verify_kyc "王五" "$JAR_C" "$IDNUM_C"

# ---------- 2. 发布需求 ----------
DEADLINE=$(python3 -c 'import datetime;print((datetime.datetime.now()+datetime.timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))')
resp=$(api "$JAR_A" POST /api/needs "{
  \"title\":\"冒烟测试需求 $RUN\",
  \"description\":\"这是一条由冒烟脚本自动创建的需求，用于验证从发布、投票、承诺到选标交付的完整链路是否可用。\",
  \"targetAudience\":\"内部测试\",
  \"expectedForm\":\"Web 应用\",
  \"targetAmountYuan\":\"1000\",
  \"deadline\":\"$DEADLINE\",
  \"voteThreshold\":1
}")
assert_ok "发布需求" "$resp"
NEED_ID=$(body_of "$resp" | json_get '.data.id')
[ -n "$NEED_ID" ] && ok "需求已创建（$NEED_ID）" || { bad "需求创建失败"; exit 1; }
NEED_STATUS=$(body_of "$resp" | json_get '.data.status')
log "需求初始状态：$NEED_STATUS"

# ---------- 3. 投票 ----------
resp=$(api "$JAR_B" POST "/api/needs/$NEED_ID/vote" '{"action":"UP"}')
assert_ok "投票支持" "$resp"

resp=$(api "$JAR_B" GET "/api/needs/$NEED_ID")
VOTES=$(body_of "$resp" | json_get '.data.voteCount')
[ "$VOTES" = "1" ] && ok "票数已累加（voteCount=1）" || bad "票数异常：$VOTES"

# ---------- 4. 提权为运营（演示环境专用，驱动状态流转）----------
PROMOTE=$($COMPOSE exec -T postgres psql -U \
  "$(grep -E '^POSTGRES_USER=' deploy/.env.production | cut -d= -f2- || echo crowd)" \
  -d "$(grep -E '^POSTGRES_DB=' deploy/.env.production | cut -d= -f2- || echo crowd_demand)" \
  -tAc "UPDATE \"User\" SET roles = array_append(roles, 'OPERATOR') WHERE id = '$UID_A' AND NOT ('OPERATOR' = ANY(roles)) RETURNING id" 2>&1)
case "$PROMOTE" in
  *"$UID_A"*|"") ok "发起者已具备运营权限" ;;
  *) bad "提权失败：$PROMOTE" ;;
esac

# ---------- 5. 征集 → 承诺 ----------
# 投票达到阈值后系统会自动进入「承诺中」，这里按实际状态决定是否手动流转
resp=$(api "$JAR_A" GET "/api/needs/$NEED_ID")
CUR_STATUS=$(body_of "$resp" | json_get '.data.status')
if [ "$CUR_STATUS" = "COLLECTING" ]; then
  resp=$(api "$JAR_A" POST "/api/needs/$NEED_ID/status" '{"to":"PLEDGING"}')
  assert_ok "流转到「承诺中」" "$resp"
  CUR_STATUS="PLEDGING"
elif [ "$CUR_STATUS" = "PLEDGING" ]; then
  ok "投票达标后自动进入「承诺中」"
else
  bad "需求状态异常：$CUR_STATUS"
fi

resp=$(api "$JAR_B" POST "/api/needs/$NEED_ID/pledges" '{"amountYuan":"600","idempotencyKey":"'$RUN'-p1"}')
assert_ok "付费承诺 600 元" "$resp"
PLEDGE_ID=$(body_of "$resp" | json_get '.data.pledgeId')

# 幂等校验：同一幂等键重复提交应返回同一笔承诺
resp=$(api "$JAR_B" POST "/api/needs/$NEED_ID/pledges" '{"amountYuan":"600","idempotencyKey":"'$RUN'-p1"}')
REPLAY_ID=$(body_of "$resp" | json_get '.data.pledgeId')
[ -n "$PLEDGE_ID" ] && [ "$PLEDGE_ID" = "$REPLAY_ID" ] && ok "承诺幂等生效（重复提交未重复计账）" || bad "幂等失效：$PLEDGE_ID vs $REPLAY_ID"

# 补足到目标额，应自动进入「竞标中」
resp=$(api "$JAR_B" POST "/api/needs/$NEED_ID/pledges" '{"amountYuan":"400","idempotencyKey":"'$RUN'-p2"}')
assert_ok "补足承诺 400 元" "$resp"
FUNDED=$(body_of "$resp" | json_get '.data.needStatus')
[ "$FUNDED" = "BIDDING" ] && ok "达标后自动进入「竞标中」" || bad "达标后状态异常：$FUNDED"

# ---------- 6. 开发者提案 ----------
resp=$(api "$JAR_C" POST /api/roles/apply '{"role":"BUILDER"}')
assert_ok "申请开发者角色" "$resp"

resp=$(api "$JAR_C" POST "/api/needs/$NEED_ID/proposals" "{
  \"understanding\":\"理解：需求方需要的是一套可按里程碑验收的定制交付，核心痛点是交付过程不透明、付款与验收脱节。方案需要把范围、节点、验收标准在开工前写清楚。\",
  \"spec\":\"方案：1）设计阶段产出信息架构与原型，交付可点击原型链接；2）开发阶段按节点提测，每节点附变更说明与自测记录；3）验收阶段提供部署包与使用文档，缺陷在约定期内免费修复。里程碑之间不提前收款，验收通过后再触发放款。\",
  \"quoteYuan\":\"900\",
  \"durationDays\":7,
  \"pastCases\":\"内部测试用例\"
}")
assert_ok "提交提案" "$resp"
PROPOSAL_ID=$(body_of "$resp" | json_get '.data.id')
[ -n "$PROPOSAL_ID" ] && ok "提案已提交（$PROPOSAL_ID）" || bad "提案创建失败"

# ---------- 6.1 支持者用承诺选票投票（F13） ----------
resp=$(api "$JAR_B" POST "/api/needs/$NEED_ID/proposal-vote" "{\"proposalId\":\"$PROPOSAL_ID\"}")
assert_ok "支持者投票" "$resp"
VOTE_WEIGHT=$(body_of "$resp" | json_get '.data.weight')
[ "$VOTE_WEIGHT" = "100000" ] && ok "票权=承诺金额（1000 元 → 100000 分）" || bad "票权异常：$VOTE_WEIGHT"

# 重复投同一提案应幂等，不重复计票
resp=$(api "$JAR_B" POST "/api/needs/$NEED_ID/proposal-vote" "{\"proposalId\":\"$PROPOSAL_ID\"}")
REPLAY_CHANGED=$(body_of "$resp" | json_get '.data.changed')
if [ "$REPLAY_CHANGED" = "False" ] || [ "$REPLAY_CHANGED" = "false" ]; then
  ok "重复投票幂等（changed=false）"
else
  bad "投票幂等异常：changed=$REPLAY_CHANGED"
fi

# 未付订金者（发起者本人）不得投票
resp=$(api "$JAR_A" POST "/api/needs/$NEED_ID/proposal-vote" "{\"proposalId\":\"$PROPOSAL_ID\"}")
VOTE_DENY_CODE=$(code_of "$resp")
[ "$VOTE_DENY_CODE" = "403" ] && ok "未付订金者投票被拒（403）" || bad "投票权限异常：HTTP $VOTE_DENY_CODE"

# 提案列表应聚合出票数与票权
resp=$(api "$JAR_A" GET "/api/needs/$NEED_ID/proposals")
assert_ok "读取提案列表" "$resp"
VOTE_COUNT=$(body_of "$resp" | json_get '.data.items.0.voteCount')
VOTE_TOTAL=$(body_of "$resp" | json_get '.data.items.0.voteWeight')
[ "$VOTE_COUNT" = "1" ] && ok "提案聚合票数=1" || bad "票数聚合异常：$VOTE_COUNT"
[ "$VOTE_TOTAL" = "100000" ] && ok "提案聚合票权=100000 分" || bad "票权聚合异常：$VOTE_TOTAL"


# ---------- 7. 选标 → 建项目与里程碑 ----------
resp=$(api "$JAR_A" POST "/api/needs/$NEED_ID/select-proposal" "{\"proposalId\":\"$PROPOSAL_ID\"}")
assert_ok "发起者选标" "$resp"
PROJECT_ID=$(body_of "$resp" | json_get '.data.projectId')
[ -z "$PROJECT_ID" ] && PROJECT_ID=$(body_of "$resp" | json_get '.data.project.id')
[ -n "$PROJECT_ID" ] && ok "项目已创建（$PROJECT_ID）" || bad "项目创建失败"

resp=$(api "$JAR_C" GET "/api/projects/$PROJECT_ID/milestones")
assert_ok "读取里程碑总览（拆分前为空）" "$resp"

# ---------- 8. 开发者拆分里程碑 ----------
resp=$(api "$JAR_C" POST "/api/projects/$PROJECT_ID/milestones" '{
  "items":[
    {"title":"节点一：原型与规格","deliverable":"可点击原型链接 + 规格说明书","releaseRatio":5000},
    {"title":"节点二：可用版本","deliverable":"部署包 + 使用文档，含自测记录","releaseRatio":5000}
  ]
}')
assert_ok "拆分里程碑（2 个节点）" "$resp"

resp=$(api "$JAR_C" GET "/api/projects/$PROJECT_ID/milestones")
MILESTONE_ID=$(body_of "$resp" | json_get '.data.milestones.0.id')
MILESTONE_AMT=$(body_of "$resp" | json_get '.data.milestones.0.releaseAmount')
[ -n "$MILESTONE_ID" ] && ok "里程碑已生成（$MILESTONE_ID，放款 $MILESTONE_AMT 分）" || bad "未生成里程碑"

# ---------- 9. 交付与验收 ----------
if [ -n "$MILESTONE_ID" ]; then
  resp=$(api "$JAR_C" POST "/api/milestones/$MILESTONE_ID/submit" '{"note":"冒烟测试：首个节点交付物已上传"}')
  assert_ok "开发者提交交付物" "$resp"

  resp=$(api "$JAR_A" POST "/api/milestones/$MILESTONE_ID/accept" '{"note":"冒烟测试：验收通过"}')
  assert_ok "发起者验收通过（触发放款）" "$resp"
fi

# ---------- 9. 结果核对 ----------
resp=$(api "$JAR_C" GET /api/reputation/me)
assert_ok "读取开发者信誉分" "$resp"

resp=$(api "$JAR_B" GET /api/pledges/mine)
assert_ok "读取我的承诺" "$resp"
MY_PLEDGES=$(body_of "$resp" | json_get '.data.items.0.amount')
[ -n "$MY_PLEDGES" ] && ok "承诺记录可见（金额=$MY_PLEDGES 分）" || bad "承诺记录缺失"

resp=$(api "$JAR_A" GET "/api/needs/$NEED_ID")
FINAL_STATUS=$(body_of "$resp" | json_get '.data.status')
log "需求当前状态：$FINAL_STATUS"

echo
if [ "$FAIL" -eq 0 ]; then
  printf '\033[1;32m[smoke] 全部通过：%d 项检查\033[0m\n' "$PASS"
  exit 0
fi
printf '\033[1;31m[smoke] 失败 %d 项，通过 %d 项\033[0m\n' "$FAIL" "$PASS"
exit 1
