# 多阶段构建：deps → builder → runner
# 使用 debian slim 而非 alpine：Prisma 引擎在 glibc 环境下更稳定
FROM node:22-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ---------- 依赖 ----------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# 国内网络可用 --registry=https://registry.npmmirror.com 加速
RUN npm ci --no-audit --no-fund

# ---------- 构建 ----------
FROM base AS builder
WORKDIR /app
# 构建期占位值：Next 在 Collecting page data 阶段会执行 env 校验，
# 缺少必填项会直接构建失败。这里只用于通过校验，运行时会由 compose 注入真实值。
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build?schema=public"
ENV AUTH_SECRET="build-time-placeholder-secret-not-used-at-runtime"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 构建期需要生成 Prisma Client；若网络受限可加 PRISMA_ENGINES_MIRROR
RUN npx prisma generate && npm run build

# ---------- 运行 ----------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Prisma 引擎与 schema：运行时仅需 @prisma/client 连库，
# 建表由部署脚本用 prisma/init.sql 完成，故不复制 Prisma CLI（其依赖树在 standalone 中不完整）
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --chown=nextjs:nodejs deploy/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
# 附件存储目录：先建好并授权，命名卷首次挂载会继承该属主
RUN mkdir -p /app/storage/uploads && chown -R nextjs:nodejs /app/storage

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
