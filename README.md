# 聚需 · crowd-demand

> 让真实需求被陌生人用真金白银筛选出来，由开发者竞标交付，按里程碑放款。

一个社区驱动的需求众筹开发平台。任何实名用户可以提出需求，陌生人投票表明"这不只是我一个人的问题"，再用**付费承诺**把零成本的点赞转化为真实的购买意愿；开发者带着方案和报价竞标，资金由平台托管，按里程碑验收后放款。

---

## 为什么做这个

"发需求 + 陌生人投票"这类平台并不缺，缺的是**投票之后有人负责**。

| 现有形态 | 缺陷 |
|---|---|
| Canny / UserVoice 等产品反馈板 | 每个板子只属于一家公司，不是公共需求市场 |
| Decidim / Make.org 等公民提案平台 | 主办方是政府或机构，有议题和身份限制 |
| Reddit / Product Hunt | 投票只决定"什么火"，没人有义务实现 |
| Change.org / Kickstarter | 一个是表态，一个是募资，都不是需求优先级机制 |

本项目的核心判断是：**票 ≠ 钱，需求 ≠ 方案**。所以平台不把票数当作开发指令，而是设计了一条四段闭环，每一段都有独立的验证机制。

## 核心机制

```
发布需求 → 陌生人投票（发现信号）→ 付费承诺达标（真实需求验证）
   → 开发者提案竞标（需求转方案）→ 选标托管 → 里程碑验收 → 按节点放款 → 最终结算
```

四个关键设计：

1. **票只用于排序，钱才触发开发。** 票数达标只是把需求推进到"承诺中"，真正启动开发的门槛是托管金额达标。
2. **需求不直接派单，而是竞标。** 同一需求接受多份方案（报价 + 工期 + 里程碑计划），由需求发起者选标，避免"照着一句话开发"。
3. **资金全程托管，按里程碑放款。** 复式账本记录每一笔资金流向，验收通过才释放对应节点金额。
4. **失败可退。** 承诺期内未达标自动流拍，全额原路退款；最终结算时按比例退回结余。

## 功能清单

### P0（已实现，20 项）

| 模块 | 编号 | 功能 |
|---|---|---|
| 账号 | F01 | 手机号验证码注册登录（注册即登录） |
| | F02 | 实名认证（身份证校验 + 一人一号 + HMAC 脱敏存储） |
| | F03 | 角色申请与信誉分（需求方 / 开发者 / 运营） |
| 需求 | F04 | 需求发布（草稿 / 发布 / 校验） |
| | F05 | 需求列表与详情 |
| | F06 | 需求状态机（9 状态集中流转 + 状态日志） |
| | F07 | 一人一票投票（实名门槛、幂等、达标自动流转） |
| | F08 | 热度榜与承诺榜 |
| 资金 | F09 | 付费承诺（额度校验、幂等键、事务） |
| | F10 | 资金托管与复式账本 |
| | F11 | 达标判定与自动退款 |
| 提案 | F12 | 开发者提案提交 |
| | F13 | 提案选择与中标（生成项目） |
| 交付 | F14 | 里程碑拆分与提交 |
| | F15 | 里程碑验收 |
| | F16 | 里程碑放款 |
| | F17 | 最终结算（差额按比例退回） |
| 运营 | F18 | 管理后台（需求强制流转） |
| | F19 | 资金流水查看 |
| | F20 | 举报与处理 |

### P1（待实现）

需求模板引导、反刷票增强、承诺退出、开发者作品集、交付物托管、评价与退款率、数据看板。

## 技术栈

| 层次 | 选型 | 选择理由 |
|---|---|---|
| 全栈框架 | Next.js 15 (App Router) + React 19 | 服务端渲染利于需求广场 SEO，Route Handler 省掉独立后端 |
| 语言 | TypeScript 5.7 (strict) | 资金与状态机逻辑需要强类型兜底 |
| 数据库 | PostgreSQL 16 | 事务与唯一约束满足资金一致性要求 |
| ORM | Prisma 6 | Schema 即文档，迁移可追溯 |
| 认证 | jose JWT + HttpOnly Cookie | 比 Auth.js 更轻，接口层统一 `getSession()`，可替换 |
| 校验 | Zod | 边界输入校验 |
| 样式 | Tailwind CSS 3.4 | 快速迭代 |
| 测试 | Vitest | 领域层用内存 mock，无需真实数据库即可验证业务规则 |
| 部署 | Docker + Docker Compose | 单机可复现部署 |

### 三条不可妥协的技术规则

1. **金额一律用整数分（`BigInt`）**，禁止浮点参与计算。
2. **状态流转集中在状态机**，业务代码不得直接改 `status` 字段。
3. **支付 / 短信 / 实名走适配器**，MVP 使用 Mock，生产环境缺少真实实现时直接抛错拦截。

## 快速开始

### 前置要求

- Node.js ≥ 20
- PostgreSQL 16（或 Docker）

### 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 准备环境变量
cp .env.example .env
# 编辑 .env，至少确认 DATABASE_URL 与 AUTH_SECRET

# 3. 启动依赖服务（PostgreSQL / Redis / MinIO）
docker compose up -d

# 4. 初始化数据库
npx prisma generate
npm run db:push

# 5. 写入演示数据（可选）
npm run db:seed

# 6. 启动开发服务器
npm run dev
```

访问 http://localhost:3000

> **网络受限环境**：若 `npm install` 卡在 Prisma 引擎下载，改用
> `npm install --registry=https://registry.npmmirror.com`，
> 生成客户端时加 `PRISMA_ENGINES_MIRROR=https://npmmirror.com/mirrors/prisma`。

### 演示账号

`npm run db:seed` 会写入一批演示用户与需求。开发环境下短信为 Mock，**验证码会直接打印在服务端日志里**，也可在登录页的提示区域看到。

## 目录结构

```
crowd-demand/
├── AGENTS.md                    # 开发规则（AI/人协作必读）
├── prisma/
│   ├── schema.prisma            # 数据模型（16 张表）
│   └── seed.ts                  # 演示数据
├── src/
│   ├── app/
│   │   ├── (public)/            # 公开页：需求广场、详情、登录
│   │   ├── (console)/           # 登录后：控制台、需求管理、实名、承诺、提案
│   │   ├── admin/               # 运营后台
│   │   └── api/                 # 26 个 Route Handler
│   ├── domain/                  # 领域层（业务规则的唯一来源）
│   │   ├── auth/ kyc/ role/ reputation/
│   │   ├── need/ vote/ pledge/ proposal/
│   │   ├── ledger/ milestone/ payout/
│   │   └── report/ shared/
│   ├── infrastructure/          # 适配器：prisma / sms / kyc / payment
│   ├── components/              # UI 组件
│   └── lib/                     # money / session / env / api-response / audit
├── tests/                       # 单元测试（内存 mock，不依赖数据库）
├── docs/                        # 需求、方案、每个功能的档案
│   ├── PRD.md
│   ├── 开发方案.md
│   ├── 技术栈.md
│   ├── 部署流程.md
│   └── F01-用户注册登录/ ...     # 每个功能一目录，含说明 + 改动记录
└── deploy/                      # 生产部署（Dockerfile / compose / nginx）
```

## 数据模型概览

16 张核心表，围绕四条链路组织：

- **身份**：`User` `KycRecord` `VerificationCode`
- **需求**：`Need` `NeedStatusLog` `Vote`
- **资金**：`Pledge` `PaymentOrder` `LedgerEntry` `Payout`
- **交付**：`Proposal` `ProposalVote` `Project` `Milestone`
- **治理**：`AuditLog` `Report`

关键约束：
- `User.kycIdNumberHash` 唯一 → 一人一号
- `Vote @@unique([needId, userId])` → 一人一票
- `Proposal @@unique([needId, builderId])` → 一个开发者对一需求只有一份提案
- `Project.needId @unique` → 一个需求只能产生一个项目
- `LedgerEntry.idempotencyKey @unique` → 资金操作幂等

## 测试

```bash
npm run typecheck   # 类型检查
npm test            # 单元测试（117 个用例）
npm run build       # 生产构建
```

测试策略：领域服务通过依赖注入接收 `db` 与适配器，测试用内存 mock 实现，覆盖状态机流转、投票幂等、账本借贷平衡、承诺额度、里程碑比例等业务规则，不需要启动数据库。

## 部署

生产部署见 **[docs/部署流程.md](docs/部署流程.md)**，包含 Docker 单机部署、手动部署、数据库迁移、备份与常见故障处理。

## 合规声明

本项目涉及资金归集与实名信息，落地前必须确认：

- 仅做**预购 / 定制开发**，不承诺任何投资收益、股权或分红（避免触碰非法集资红线）。
- 资金必须进入**持牌第三方托管账户**，平台不得自建资金池。MVP 中的支付为 Mock 适配器，生产环境会直接抛错拦截。
- 身份证号仅存储 **HMAC-SHA256 哈希**，明文不落库、不出现在任何 API 响应。
- 所有敏感操作写审计日志，日志不可物理删除。

## 当前状态

- P0 的 20 个功能已完整实现并通过类型检查、单元测试与生产构建。
- 支付、短信、实名三个外部能力仍为 Mock 适配器。
- 多支持者联合验收、定时任务（BullMQ 自动结算）、Playwright E2E 尚未实现。
- 生产部署前需执行 `prisma migrate deploy` 建立真实表结构。

## 开发规范

新增功能前请先读 [AGENTS.md](AGENTS.md)。核心约定：**每开发一个功能，必须在 `docs/` 下新建 `Fxx-功能名/` 目录，内含 `功能详细说明.md` 与 `改动记录.md`**，从 `docs/_TEMPLATE/` 复制模板。
