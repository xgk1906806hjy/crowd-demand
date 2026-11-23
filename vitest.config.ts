import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
    // 使用进程池而非线程池：Windows 下线程池偶发挂起
    pool: "forks",
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      AUTH_SECRET: "test-secret-at-least-16-characters-long",
      REDIS_URL: "redis://localhost:6379",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
