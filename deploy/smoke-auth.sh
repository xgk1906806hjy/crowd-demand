#!/usr/bin/env bash
# F01 v0.5 / F31 认证冒烟：邮箱验证码注册登录 + 密码登录 + 邮箱绑定 + 防爆破
#
# 用法（在部署机执行，需 docker compose 权限以读取 Mock 验证码）：
#   ./deploy/smoke-auth.sh                       # 默认 http://127.0.0.1:8000
set -uo pipefail

cd "$(dirname "$0")/.."
BASE="${1:-http://127.0.0.1:8000}"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file deploy/.env.production"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0
log()  { printf '\033[1;34m[auth]\033[0m %s\n' "$*"; }
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

# Mock 验证码：短信 [MockSMS] to=<phone> / 邮件 [MockEmail] to=<email>
mock_code() {
  local pattern="$1" code=""
  for _ in $(seq 1 10); do
    code=$($COMPOSE logs --tail=150 app 2>/dev/null \
      | grep "$pattern" | tail -1 \
      | sed -n 's/.*code=\([0-9]\{6\}\).*/\1/p')
    [ -n "$code" ] && break
    sleep 1
  done
  printf '%s' "$code"
}

log "目标地址：$BASE"
RUN=$(date +%s | rev | cut -c1-8 | rev)
PHONE="134$RUN"
EMAIL="smoke${RUN}@example.com"
PW="1Aa!${RUN:0:4}"

JAR="$TMP/a.jar"
JAR2="$TMP/b.jar"

# ---------- 1. 手机号验证码注册（回归） ----------
resp=$(api "$JAR" POST /api/auth/send-code "{\"phone\":\"$PHONE\"}")
assert_ok "发送短信验证码" "$resp"
CODE=$(mock_code "\[MockSMS\] to=$PHONE")
[ -n "$CODE" ] && ok "读取 Mock 短信码" || { bad "读取短信码失败"; exit 1; }
resp=$(api "$JAR" POST /api/auth/verify "{\"phone\":\"$PHONE\",\"code\":\"$CODE\"}")
assert_ok "手机号注册登录" "$resp"
USER_ID=$(body_of "$resp" | json_get '.data.user.id')

# ---------- 2. me 返回 email/hasPassword ----------
resp=$(api "$JAR" GET /api/auth/me)
assert_ok "读取当前用户" "$resp"
assert_eq "初始未设密码" "$(body_of "$resp" | json_get '.data.hasPassword')" "False"

# ---------- 3. 设置密码 + 密码登录 ----------
resp=$(api "$JAR" POST /api/auth/password/set '{"password":"abc"}')
assert_eq "弱密码被拒（400）" "$(code_of "$resp")" "400"
resp=$(api "$JAR" POST /api/auth/password/set "{\"password\":\"$PW\"}")
assert_ok "设置密码" "$resp"

resp=$(api "$JAR2" POST /api/auth/password/login "{\"account\":\"$PHONE\",\"password\":\"$PW\"}")
assert_ok "手机号+密码登录" "$resp"
assert_eq "密码登录落到同一账号" "$(body_of "$resp" | json_get '.data.user.id')" "$USER_ID"

# 改密需旧密码（新密码本身须符合强度规则，确保命中的是"缺旧密码"分支）
resp=$(api "$JAR" POST /api/auth/password/set '{"password":"2Bb@5678"}')
assert_eq "改密缺旧密码被拒（400）" "$(code_of "$resp")" "400"

# ---------- 4. 绑定邮箱（BIND 码） ----------
resp=$(api "$JAR" POST /api/auth/send-code "{\"email\":\"$EMAIL\",\"purpose\":\"BIND\"}")
assert_ok "发送绑定验证码" "$resp"
BIND_CODE=$(mock_code "\[MockEmail\] to=$EMAIL")
[ -n "$BIND_CODE" ] && ok "读取 Mock 邮件码" || { bad "读取邮件码失败"; exit 1; }

# LOGIN 用途隔离：BIND 码不能登录
resp=$(api "$JAR2" POST /api/auth/verify "{\"email\":\"$EMAIL\",\"code\":\"$BIND_CODE\"}")
assert_eq "BIND 码不能用于登录（404）" "$(code_of "$resp")" "404"

resp=$(api "$JAR" POST /api/auth/email/bind "{\"email\":\"$EMAIL\",\"code\":\"$BIND_CODE\"}")
assert_ok "绑定邮箱" "$resp"
resp=$(api "$JAR" GET /api/auth/me)
assert_eq "me 返回已绑定邮箱" "$(body_of "$resp" | json_get '.data.email')" "$EMAIL"
assert_eq "me 返回已设密码" "$(body_of "$resp" | json_get '.data.hasPassword')" "True"

# 邮箱+密码登录
resp=$(api "$JAR2" POST /api/auth/password/login "{\"account\":\"$EMAIL\",\"password\":\"$PW\"}")
assert_ok "邮箱+密码登录" "$resp"
assert_eq "邮箱密码登录同一账号" "$(body_of "$resp" | json_get '.data.user.id')" "$USER_ID"

# ---------- 5. 邮箱验证码登录（新账号注册） ----------
EMAIL2="smoke${RUN}b@example.com"
resp=$(api "$JAR2" POST /api/auth/send-code "{\"email\":\"$EMAIL2\"}")
assert_ok "发送邮箱登录验证码" "$resp"
CODE2=$(mock_code "\[MockEmail\] to=$EMAIL2")
resp=$(api "$JAR2" POST /api/auth/verify "{\"email\":\"$EMAIL2\",\"code\":\"$CODE2\"}")
assert_ok "邮箱验证码注册登录" "$resp"
USER_ID2=$(body_of "$resp" | json_get '.data.user.id')
[ -n "$USER_ID2" ] && [ "$USER_ID2" != "$USER_ID" ] && ok "邮箱注册为独立新账号" || bad "邮箱注册账号异常：$USER_ID2"

# 占用冲突：把已被占用的邮箱绑到别的账号
sleep 61
resp=$(api "$JAR2" POST /api/auth/send-code "{\"email\":\"$EMAIL\",\"purpose\":\"BIND\"}")
assert_ok "发送占用邮箱的绑定码" "$resp"
CODE3=$(mock_code "\[MockEmail\] to=$EMAIL purpose=BIND")
resp=$(api "$JAR2" POST /api/auth/email/bind "{\"email\":\"$EMAIL\",\"code\":\"$CODE3\"}")
assert_eq "占用邮箱绑定被拒（409）" "$(code_of "$resp")" "409"

# ---------- 6. 防爆破：连续失败锁定 ----------
for i in 1 2 3 4; do
  resp=$(api "$JAR2" POST /api/auth/password/login "{\"account\":\"$PHONE\",\"password\":\"wrongpw99\"}")
  assert_eq "第 $i 次错误密码（401）" "$(code_of "$resp")" "401"
done
resp=$(api "$JAR2" POST /api/auth/password/login "{\"account\":\"$PHONE\",\"password\":\"wrongpw99\"}")
assert_eq "第 5 次失败触发锁定（429）" "$(code_of "$resp")" "429"
resp=$(api "$JAR2" POST /api/auth/password/login "{\"account\":\"$PHONE\",\"password\":\"$PW\"}")
assert_eq "锁定期正确密码也被拒（429）" "$(code_of "$resp")" "429"

# 防枚举：不存在的账号与错误密码同文案
resp=$(api "$JAR2" POST /api/auth/password/login '{"account":"13000000000","password":"whatever1"}')
assert_eq "不存在账号返回 401" "$(code_of "$resp")" "401"

# ---------- 7. 用户名密码注册（F32，免验证码） ----------
UNAME="smoke${RUN}u"
JAR3="$TMP/c.jar"
resp=$(api "$JAR3" POST /api/auth/register "{\"username\":\"Smoke${RUN}u\",\"password\":\"$PW\"}")
assert_eq "用户名注册成功（201）" "$(code_of "$resp")" "201"
assert_eq "用户名小写归一" "$(body_of "$resp" | json_get '.data.user.username')" "$UNAME"
UNAME_ID=$(body_of "$resp" | json_get '.data.user.id')

resp=$(api "$JAR3" GET /api/auth/me)
assert_ok "注册即登录（会话可用）" "$resp"
assert_eq "me 返回用户名" "$(body_of "$resp" | json_get '.data.username')" "$UNAME"
assert_eq "me 返回已设密码" "$(body_of "$resp" | json_get '.data.hasPassword')" "True"

resp=$(api "$JAR3" POST /api/auth/register "{\"username\":\"$UNAME\",\"password\":\"$PW\"}")
assert_eq "重复用户名被拒（409）" "$(code_of "$resp")" "409"
resp=$(api "$JAR3" POST /api/auth/register '{"username":"1bad","password":"abcd1234"}')
assert_eq "非法用户名被拒（400）" "$(code_of "$resp")" "400"
resp=$(api "$JAR3" POST /api/auth/register '{"username":"admin","password":"abcd1234"}')
assert_eq "保留用户名被拒（400）" "$(code_of "$resp")" "400"

resp=$(api "$JAR2" POST /api/auth/password/login "{\"account\":\"$UNAME\",\"password\":\"$PW\"}")
assert_ok "用户名+密码登录" "$resp"
assert_eq "用户名登录落到同一账号" "$(body_of "$resp" | json_get '.data.user.id')" "$UNAME_ID"
resp=$(api "$JAR2" POST /api/auth/password/login "{\"account\":\"$UNAME\",\"password\":\"wrongpw99\"}")
assert_eq "用户名错误密码（401）" "$(code_of "$resp")" "401"

log "结果：通过 $PASS 项，失败 $FAIL 项"
[ "$FAIL" -eq 0 ] || exit 1
