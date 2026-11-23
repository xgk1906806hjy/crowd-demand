#!/bin/sh
# 容器启动入口：先同步数据库结构，再启动 Next standalone 服务
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

if [ -d "prisma/migrations" ] && [ -n "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "[entrypoint] applying migrations..."
  node node_modules/prisma/build/index.js migrate deploy
else
  echo "[entrypoint] no migrations found, syncing schema with db push..."
  node node_modules/prisma/build/index.js db push --skip-generate
fi

echo "[entrypoint] starting server..."
exec node server.js
