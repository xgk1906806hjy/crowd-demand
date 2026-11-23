/** @type {import('next').NextConfig} */
const nextConfig = {
  // 生产镜像使用 standalone 产物，运行时不带完整 node_modules
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "prisma"],
  experimental: {
    // 限制构建 worker 数量：并行 worker 在内存受限环境下会卡在 Collecting page data
    cpus: 1,
  },
};

export default nextConfig;
