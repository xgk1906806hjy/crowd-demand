#!/bin/sh
# 容器启动入口：只等数据库就绪，然后启动 Next standalone 服务。
# 数据库结构由 deploy/deploy.sh 用 prisma/init.sql 幂等应用，
# 运行容器不依赖 Prisma CLI（standalone 镜像内没有完整 CLI 依赖树）。
set -e

echo "[entrypoint] waiting for database..."
i=0
until node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$queryRaw\`SELECT 1\`.then(() => process.exit(0)).catch(() => process.exit(1));
" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 30 ]; then
    echo "[entrypoint] database not reachable after 60s, aborting" >&2
    exit 1
  fi
  sleep 2
done
echo "[entrypoint] database is up"

echo "[entrypoint] starting server..."
exec node server.js
