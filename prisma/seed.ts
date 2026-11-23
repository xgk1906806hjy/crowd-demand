import { PrismaClient, UserRole, KycStatus, NeedStatus } from "@prisma/client";

const prisma = new PrismaClient();

/** 开发种子数据：一个运营方账号 + 两个示例需求。仅用于本地联调。 */
async function main() {
  const operator = await prisma.user.upsert({
    where: { phone: "10000000000" },
    create: {
      phone: "10000000000",
      nickname: "平台运营",
      roles: [UserRole.OPERATOR],
      kycStatus: KycStatus.VERIFIED,
    },
    update: {},
  });

  const requester = await prisma.user.upsert({
    where: { phone: "13800138000" },
    create: { phone: "13800138000", nickname: "示例用户", roles: [UserRole.REQUESTER, UserRole.BACKER] },
    update: {},
  });

  const need = await prisma.need.findFirst({ where: { title: "自动整理发票的小工具" } });
  if (!need) {
    await prisma.need.create({
      data: {
        requesterId: requester.id,
        title: "自动整理发票的小工具",
        description: "希望能有一个工具，导入一堆电子发票 PDF，自动识别并整理成可报销的表格。",
        targetAudience: "经常出差的职场人",
        expectedForm: "桌面端小工具 / Web 应用",
        status: NeedStatus.COLLECTING,
        targetAmount: 100000n, // 1000.00 元
        voteThreshold: 100,
      },
    });
  }

  console.info("Seed 完成:", { operator: operator.id, requester: requester.id });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
