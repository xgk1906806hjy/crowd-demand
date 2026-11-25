#!/usr/bin/env bash
# F28 悬赏闭环冒烟：对已部署实例验证「有偿悬赏」全流程
#   发布悬赏 → 全额托管 → 开发者提案（额度校验）→ 悬赏下禁止众筹投票 → 撤回退款 → 无偿认领
#
# 用法（在部署机执行，需 docker compose 权限以读取 Mock 短信码与核对账本）：
#   ./deploy/smoke-f28.sh                       # 默认 http://127.0.0.1:8000
#   ./deploy/smoke-f28.sh http://192.168.100.91:8000
set -uo pipefail

cd "$(dirname "$0")/.."
BASE="${1:-http://127.0.0.1:8000}"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file deploy/.env.production"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
log()  { printf '\033[1;34m[f28]\033[0m %s\n' "$*"; }
ok()   { PASS=$((PASS + 1)); printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
bad()  { FAIL=$((FAIL + 1)); printf '\033[1;31m  ✗\033[0m %s\n' "$*"; }

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
    curl -s -m 25 -b "$jar" -c "$jar" -X "$method" \
      -H 'content-type: application/json' -d "$data" "$BASE$path" -w '\n%{http_code}'
  else
    curl -s -m 25 -b "$jar" -c "$jar" -X "$method" "$BASE$path" -w '\n%{http_code}'
  fi
}

body_of() { printf '%s' "$1" | sed '$d'; }
code_of() { printf '%s' "$1" | tail -1; }

assert_ok() {
  local label="$1" resp="$2"; local code; code=$(code_of "$resp")
  if [ "$code" = "200" ]; then ok "$label"
  else bad "$label（HTTP $code：$(body_of "$resp" | head -c 200)）"; fi
}

assert_eq() {
  local label="$1" actual="$2" expect="$3"
  if [ "$actual" = "$expect" ]; then ok "$label"
  else bad "$label（期望 $expect，实际 ${actual:-空}）"; fi
}

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

gen_idnum() {
  python3 -c '
import sys
body = sys.argv[1]
w = [7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]
m = "10X98765432"
print(body + m[sum(int(c) * wi for c, wi in zip(body, w)) % 11])
' "$1"
}

register_user() {
  local tag="$1" phone="$2" jar="$3" resp code
  resp=$(api "$jar" POST /api/auth/send-code "{\"phone\":\"$phone\"}")
  assert_ok "发送验证码（$tag）" "$resp" >&2
  code=$(mock_code "$phone")
  if [ -z "$code" ]; then bad "读取 Mock 验证码（$tag）"; return 1; fi
  resp=$(api "$jar" POST /api/auth/verify "{\"phone\":\"$phone\",\"code\":\"$code\"}")
  assert_ok "登录（$tag）" "$resp" >&2
}

verify_kyc() {
  local tag="$1" jar="$2" idnum="$3" resp
  resp=$(api "$jar" POST /api/kyc/submit "{\"realName\":\"$tag\",\"idNumber\":\"$idnum\"}")
  assert_ok "实名认证（$tag）" "$resp"
}

PGU=$(grep -E '^POSTGRES_USER=' deploy/.env.production | cut -d= -f2- || echo crowd)
PGD=$(grep -E '^POSTGRES_DB=' deploy/.env.production | cut -d= -f2- || echo crowd_demand)
PSQL() { $COMPOSE exec -T postgres psql -U "$PGU" -d "$PGD" -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }

# 托管账户净额（分）：CREDIT 流入，DEBIT 流出
escrow_net() {
  PSQL "SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END),0) FROM \"LedgerEntry\" WHERE \"accountType\"='ESCROW'"
}
# 某用户的承诺账户净额（分）
backer_net() {
  PSQL "SELECT COALESCE(SUM(CASE WHEN direction='CREDIT' THEN amount ELSE -amount END),0) FROM \"LedgerEntry\" WHERE \"accountType\"='BACKER' AND \"accountId\"='$1'"
}

log "目标地址：$BASE"
RUN=$(date +%s | rev | cut -c1-8 | rev)
PHONE_A="136$RUN"
PHONE_C="135$RUN"
SEQ=$((10#${RUN:5:3} % 900 + 100))
IDNUM_A=$(gen_idnum "32010219910207$SEQ")
IDNUM_C=$(gen_idnum "44030519960606$SEQ")

JAR_A="$TMP/a.jar"; JAR_C="$TMP/c.jar"
register_user "悬赏需求方" "$PHONE_A" "$JAR_A" || exit 1
register_user "悬赏开发者" "$PHONE_C" "$JAR_C" || exit 1
verify_kyc "赵六" "$JAR_A" "$IDNUM_A"
verify_kyc "孙七" "$JAR_C" "$IDNUM_C"

resp=$(api "$JAR_A" GET /api/auth/me)
UID_A=$(body_of "$resp" | json_get '.data.id')
[ -n "$UID_A" ] && ok "会话有效（userId=$UID_A）" || bad "获取当前用户失败"
ESCROW_BEFORE=$(escrow_net); ESCROW_BEFORE=${ESCROW_BEFORE:-0}
BACKER_BEFORE=$(backer_net "$UID_A"); BACKER_BEFORE=${BACKER_BEFORE:-0}

# ---------- 1. 发布有偿悬赏：2000 元，征集 14 天 ----------
resp=$(api "$JAR_A" POST /api/needs "{
  \"title\":\"悬赏冒烟需求 $RUN\",
  \"description\":\"这是一条由 F28 冒烟脚本创建的有偿悬赏需求，用于验证悬赏预付托管、方案征集与撤回退款的完整链路。\",
  \"mode\":\"BOUNTY\",
  \"bountyAmountYuan\":\"2000\",
  \"bountyDays\":14
}")
assert_ok "发布有偿悬赏" "$resp"
BOUNTY_ID=$(body_of "$resp" | json_get '.data.id')
[ -n "$BOUNTY_ID" ] && ok "悬赏需求已创建（$BOUNTY_ID）" || { bad "悬赏需求创建失败"; exit 1; }
assert_eq "创建后直接进入竞标中" "$(body_of "$resp" | json_get '.data.status')" "BIDDING"
assert_eq "返回模式为 BOUNTY" "$(body_of "$resp" | json_get '.data.mode')" "BOUNTY"
assert_eq "悬赏金额按分存储" "$(body_of "$resp" | json_get '.data.bountyAmount')" "200000"

# ---------- 2. 托管核对 ----------
ESCROW_AFTER=$(escrow_net); ESCROW_AFTER=${ESCROW_AFTER:-0}
assert_eq "托管账户净额增加 2000 元" "$((ESCROW_AFTER - ESCROW_BEFORE))" "200000"
BACKER_AFTER=$(backer_net "$UID_A"); BACKER_AFTER=${BACKER_AFTER:-0}
assert_eq "需求方承诺账户扣减 2000 元" "$((BACKER_AFTER - BACKER_BEFORE))" "-200000"
ESC_AMOUNT=$(PSQL "SELECT amount FROM \"BountyEscrow\" WHERE \"needId\"='$BOUNTY_ID'")
ESC_STATUS=$(PSQL "SELECT status FROM \"BountyEscrow\" WHERE \"needId\"='$BOUNTY_ID'")
assert_eq "托管单金额" "$ESC_AMOUNT" "200000"
assert_eq "托管单状态为持有" "$ESC_STATUS" "HELD"
PAY_ORD=$(PSQL "SELECT count(*) FROM \"PaymentOrder\" WHERE \"idempotencyKey\"='bounty-charge:$BOUNTY_ID'")
[ "${PAY_ORD:-0}" -ge 1 ] && ok "已生成支付单（$PAY_ORD 条）" || bad "未生成支付单"

# ---------- 3. 开发者提案：额度校验 ----------
resp=$(api "$JAR_C" POST /api/roles/apply '{"role":"BUILDER"}')
assert_ok "申请开发者角色" "$resp"

resp=$(api "$JAR_C" POST "/api/needs/$BOUNTY_ID/proposals" "{
  \"understanding\":\"理解：需求方预先把 2000 元悬赏金托管，希望有人按方案把这件事做完，验收后按里程碑放款。\",
  \"spec\":\"方案：1）先拆解功能范围与验收口径，产出可确认的需求清单；2）按节点交付可运行版本并附自测记录；3）全部节点验收后交付部署包与使用说明。\",
  \"quoteYuan\":\"2100\",
  \"durationDays\":10
}")
OVER_CODE=$(code_of "$resp")
[ "$OVER_CODE" = "400" ] && ok "报价超过悬赏金额被拒（400）" || bad "超额报价未被拦截：HTTP $OVER_CODE"

resp=$(api "$JAR_C" POST "/api/needs/$BOUNTY_ID/proposals" "{
  \"understanding\":\"理解：需求方预先把 2000 元悬赏金托管，希望有人按方案把这件事做完，验收后按里程碑放款。\",
  \"spec\":\"方案：1）先拆解功能范围与验收口径，产出可确认的需求清单；2）按节点交付可运行版本并附自测记录；3）全部节点验收后交付部署包与使用说明。\",
  \"quoteYuan\":\"1999\",
  \"durationDays\":10
}")
assert_ok "悬赏额度内提案提交成功" "$resp"

# ---------- 4. 悬赏下不应有众筹投票 ----------
resp=$(api "$JAR_C" POST "/api/needs/$BOUNTY_ID/proposal-vote" "{\"proposalId\":\"x\"}")
assert_eq "悬赏需求禁止支持者选票" "$(code_of "$resp")" "403"

# ---------- 5. 撤回全额退款 ----------
resp=$(api "$JAR_A" POST "/api/needs/$BOUNTY_ID/bounty-cancel")
assert_ok "撤回悬赏并退款" "$resp"
assert_eq "需求状态转为 REFUNDED" "$(body_of "$resp" | json_get '.data.status')" "REFUNDED"
assert_eq "托管单状态转为已退款" "$(PSQL "SELECT status FROM \"BountyEscrow\" WHERE \"needId\"='$BOUNTY_ID'")" "REFUNDED"
ESCROW_FINAL=$(escrow_net); ESCROW_FINAL=${ESCROW_FINAL:-0}
assert_eq "托管账户净额回到初始" "$ESCROW_FINAL" "$ESCROW_BEFORE"
assert_eq "需求方资金全额退回" "$(backer_net "$UID_A")" "$BACKER_BEFORE"
REFUND_ROWS=$(PSQL "SELECT count(*) FROM \"LedgerEntry\" WHERE \"idempotencyKey\" LIKE 'bountyrefund:$BOUNTY_ID%'")
[ "${REFUND_ROWS:-0}" -ge 2 ] && ok "退款写入复式流水（$REFUND_ROWS 条）" || bad "退款流水缺失"

# 重复撤回应幂等不重复退款
resp=$(api "$JAR_A" POST "/api/needs/$BOUNTY_ID/bounty-cancel")
DUP_STATUS=$(code_of "$resp")
[ "$DUP_STATUS" = "200" ] || [ "$DUP_STATUS" = "409" ] && ok "重复撤回未重复退款（HTTP $DUP_STATUS）" || bad "重复撤回异常：HTTP $DUP_STATUS"
assert_eq "重复撤回后托管净额不变" "$(escrow_net)" "$ESCROW_FINAL"

# ---------- 6. 无偿认领 ----------
resp=$(api "$JAR_A" POST /api/needs "{
  \"title\":\"无偿求助冒烟 $RUN\",
  \"description\":\"这是一条由 F28 冒烟脚本创建的无偿需求，用于验证不涉及资金时也能发布并接收方案。\",
  \"mode\":\"OPEN\",
  \"bountyDays\":7
}")
assert_ok "发布无偿求助" "$resp"
OPEN_ID=$(body_of "$resp" | json_get '.data.id')
assert_eq "无偿需求直接进入竞标中" "$(body_of "$resp" | json_get '.data.status')" "BIDDING"
assert_eq "无偿需求不产生托管单" "$(PSQL "SELECT count(*) FROM \"BountyEscrow\" WHERE \"needId\"='$OPEN_ID'")" "0"

resp=$(api "$JAR_C" POST "/api/needs/$OPEN_ID/proposals" "{
  \"understanding\":\"理解：这是无偿互助需求，需求方不付费，开发者自愿用业余时间帮忙实现一个小工具。\",
  \"spec\":\"方案：实现单页工具，接收一段文本并整理成结构化清单，支持复制导出；不含后端存储，一周内交付源码与使用说明。\",
  \"quoteYuan\":\"0\",
  \"durationDays\":7
}")
assert_ok "无偿需求零报价提案成功" "$resp"

log "结果：通过 $PASS 项，失败 $FAIL 项"
[ "$FAIL" -eq 0 ] || exit 1
