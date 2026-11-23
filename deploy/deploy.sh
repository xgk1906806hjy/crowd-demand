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
}

case "${1:-up}" in
  up)
    check_prereq
    log "构建镜像（首次约 3-6 分钟）..."
    $COMPOSE build
    log "启动服务..."
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
  restart) $COMPOSE restart app ;;
  down)    $COMPOSE down ;;
  status)  $COMPOSE ps ;;
  *)       fail "未知命令：$1（可用：up | logs | restart | down | status）" ;;
esac
