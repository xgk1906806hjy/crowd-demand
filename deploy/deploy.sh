#!/usr/bin/env bash
# 一键部署脚本（在服务器上执行）
# 用法：
#   ./deploy/deploy.sh            # 构建并启动
#   ./deploy/deploy.sh logs       # 查看日志
#   ./deploy/deploy.sh restart    # 重启应用
#   ./deploy/deploy.sh down       # 停止全部服务
#   ./deploy/deploy.sh status     # 查看状态
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml --env-file deploy/.env.production"

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[deploy]\033[0m %s\n' "$*" >&2; exit 1; }

check_prereq() {
  command -v docker >/dev/null 2>&1 || fail "未安装 Docker"
  docker info >/dev/null 2>&1 || fail "Docker 守护进程未运行（尝试 systemctl start docker）"
  docker compose version >/dev/null 2>&1 || fail "未安装 docker compose 插件"
  [ -f deploy/.env.production ] || fail "缺少 deploy/.env.production（复制 deploy/.env.production.example 并修改）"

  # 校验占位符是否仍未替换
  if grep -q "CHANGE_ME" deploy/.env.production; then
    fail "deploy/.env.production 仍包含 CHANGE_ME 占位符，请先修改密码与 AUTH_SECRET"
  fi

  local secret
  secret=$(grep -E '^AUTH_SECRET=' deploy/.env.production | cut -d= -f2-)
  [ ${#secret} -ge 32 ] || fail "AUTH_SECRET 长度需至少 32 字符（openssl rand -base64 48）"

  local cron
  cron=$(grep -E '^CRON_SECRET=' deploy/.env.production | cut -d= -f2- || true)
  [ ${#cron} -ge 16 ] || fail "CRON_SECRET 长度需至少 16 字符（openssl rand -hex 24）"

  # 合规红线提前拦截：生产语义下不允许 Mock 支付（避免容器启动即崩溃）
  local app_env pay
  app_env=$(envval APP_ENV production)
  pay=$(envval PAYMENT_ADAPTER mock)
  if [ "$app_env" != "demo" ] && [ "$pay" = "mock" ]; then
    fail "PAYMENT_ADAPTER=mock 且 APP_ENV=${app_env}：生产环境禁止 Mock 支付。若为内部演示实例，请显式设置 APP_ENV=demo。"
  fi
}

# 读取 .env.production 中的单个变量（无则用默认值）
envval() {
  local v
  v=$(grep -E "^$1=" deploy/.env.production | head -1 | cut -d= -f2- || true)
  printf '%s' "${v:-$2}"
}

# 幂等初始化数据库结构：
#   若 public."User" 表已存在则跳过；否则用 prisma/init.sql 建表。
# 运行容器不依赖 Prisma CLI，避免 standalone 镜像内 CLI 依赖树不完整的问题。
ensure_schema() {
  local pg_user pg_db
  pg_user=$(envval POSTGRES_USER crowd)
  pg_db=$(envval POSTGRES_DB crowd_demand)

  log "等待数据库就绪..."
  for i in $(seq 1 40); do
    if $COMPOSE exec -T postgres pg_isready -U "$pg_user" -d "$pg_db" >/dev/null 2>&1; then
      break
    fi
    if [ "$i" -eq 40 ]; then fail "数据库 80s 内未就绪"; fi
    sleep 2
  done

  local exists
  exists=$($COMPOSE exec -T postgres psql -U "$pg_user" -d "$pg_db" -tAc \
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='User' LIMIT 1" \
    2>/dev/null | tr -d '[:space:]')

  if [ "$exists" = "1" ]; then
    log "数据库结构已存在，跳过初始化"
    return 0
  fi

  [ -f prisma/init.sql ] || fail "缺少 prisma/init.sql（执行：npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/init.sql）"
  log "应用 prisma/init.sql 初始化数据库结构..."
  $COMPOSE exec -T postgres psql -v ON_ERROR_STOP=1 -U "$pg_user" -d "$pg_db" -f - < prisma/init.sql >/dev/null
  log "数据库结构初始化完成"
}

case "${1:-up}" in
  up)
    check_prereq
    log "构建镜像（首次约 3-6 分钟）..."
    $COMPOSE build
    log "启动数据库与缓存..."
    $COMPOSE up -d postgres redis
    ensure_schema
    log "启动应用与网关..."
    $COMPOSE up -d
    log "等待应用健康检查..."
    for i in $(seq 1 45); do
      state=$(docker inspect --format '{{.State.Health.Status}}' crowd-demand-app 2>/dev/null || echo "unknown")
      if [ "$state" = "healthy" ]; then
        log "应用已就绪"
        break
      fi
      if [ "$i" -eq 45 ]; then
        $COMPOSE logs --tail=60 app
        fail "健康检查超时，请查看上方日志"
      fi
      sleep 2
    done
    PORT=$(grep -E '^HTTP_PORT=' deploy/.env.production | cut -d= -f2- || echo 80)
    APP_URL=$(grep -E '^NEXT_PUBLIC_APP_URL=' deploy/.env.production | cut -d= -f2- || echo "")
    log "部署完成：${APP_URL:-http://localhost:${PORT:-80}}"
    log "健康检查：curl http://127.0.0.1:${PORT:-80}/api/health"
    ;;
  logs)    $COMPOSE logs -f --tail=100 "${2:-app}" ;;
  migrate) check_prereq; $COMPOSE up -d postgres; ensure_schema ;;
  restart) $COMPOSE restart app ;;
  down)    $COMPOSE down ;;
  status)  $COMPOSE ps ;;
  *)       fail "未知命令：$1（可用：up | migrate | logs | restart | down | status）" ;;
esac
