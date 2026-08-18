# APSi GovBid (AI-powered Procurement Intelligence)

APSi GovBid 是一个致力于帮助供应商（特别是中小企业）高效检索、筛选和管理政府招标信息的智能聚合平台。

本项目目前处于 **本地可用 MVP 深化 + 爬虫扩展阶段**。当前系统已从”招标信息聚合与检索”扩展到账号/权限、50 州 + 联邦（SAM.gov）数据采集、数据源注册表（`data_sources`）、BidNet 县市级扩展、Bonfire 平台适配、采购意向工作台、响应工作区、材料库、报价、提醒、Award / Win-Loss Lite、营销漏斗、MySQL 双运行时和生产发布准备文档。

当前统一进度以 `docs/product-requirements/winbids-implementation-status.md` 为准：

- 本地可用 MVP：约 **98%**。
- 生产发布准备：约 **73%**。
- 商业化闭环：约 **73%**。
- 公开营销首页 / 获客漏斗：约 **94%**。
- 采购工作流深度：约 **93%**。
- AI / Enterprise 深度：约 **60%**。
- 完整 PRD / 长期平台：约 **76%**。

**工程质量**：292 个测试文件 / 1,698 个测试用例全部通过，55 张数据表，41 个爬虫 spider 模块。

## ☁️ AWS 发布应用名称

- **建议展示名称**：`APSi GovBid`
- **建议 AWS Application Name**：`apsi-govbid`
- **环境命名示例**：`apsi-govbid-dev`、`apsi-govbid-staging`、`apsi-govbid-prod`

## 🌟 核心价值

美国各州县政府的招标信息高度分散在数十个不同的门户网站中，导致供应商检索效率极低。APSi 旨在打造一个统一的招标信息检索平台，初期整合 50 个州及联邦政府（SAM.gov）的公开招标信息，为用户提供一站式的数据访问体验。

## ✨ 主要功能

- **统一检索**：支持对招标标题和描述进行全文模糊搜索。
- **50 州 + 联邦数据采集**：50 个州级门户 + SAM.gov 联邦招标，41 个专用 spider 模块（含 BidNet、Bonfire 等平台适配器），deterministic release gate 覆盖 50/50 州。
- **数据源注册表（`data_sources`）**：所有爬虫执行由数据库驱动的 `data_sources` 表调度，支持 cadence 排期、source health 自动降级、治理门禁（县市级源需显式审批）和 BidNet 县市级扩展。
- **账号、角色、套餐权限**：支持普通用户注册登录、Admin/普通用户分离、Free / Pro / Business / Enterprise 功能 gate、locked/upgrade 状态和本地 paid smoke。
- **采购意向工作台**：支持 Intent 创建、资格评估、Compliance、Submission、Pursue / No-Bid、Response Workspace、Artifact Vault、Quote Workspace、Deadline Reminders。
- **响应包与材料库**：支持 Markdown/ZIP/PDF/DOCX 本地导出、导出审核状态、版本历史、对比、材料替换/version、checksum/byte-size 校验。
- **Quote / Award / Win-Loss Lite**：支持报价请求、报价比较摘要、CSV/JSON quote parser lite、Award outcome、Win/Loss learning summary。
- **Dashboard / Admin Ops**：支持角色化 Dashboard、Product 6 intelligence lite、Admin source health、risk check、Config Matrix、Marketing Content CMS lite、funnel metrics。
- **中英双语支持**：内置 i18n，可全局切换中文和英文界面。
- **SQLite / MySQL 双运行时**：SQLite 仍可用于轻量本地开发；MySQL runtime 通过 `DATABASE_URL` 自动切换，migration、smoke、worker preflight、risk gate 均已验证。

## 💻 技术栈

本项目前端和本地后端采用现代 Web 技术栈构建：

- **框架**: [Next.js 16](https://nextjs.org/) (App Router, 固定版本 16.2.6) + React 19
- **样式**: Tailwind CSS v4 + 极简主义设计规范
- **组件库**: [shadcn/ui](https://ui.shadcn.com/) (基于 Radix UI)
- **图标**: Lucide React
- **数据层**: SQLite (本地开发) / MySQL (staging/production)，运行时自动切换
- **爬虫引擎**: Python (stdlib + requests + pytest)，41 个 spider 模块，数据库驱动调度
- **本地文件/对象存储**: local object storage abstraction + S3-compatible posture preflight
- **状态管理**: React Context + typed API helpers
- **语言**: TypeScript

## 🚀 快速开始

### 环境要求

- Node.js 20+（CI 与 `frontend/Dockerfile` 均使用 Node 20）
- npm 或 pnpm 或 yarn

### 安装与运行

1. 克隆项目并进入前端目录：
   ```bash
   cd frontend
   ```

2. 安装依赖：
   ```bash
   npm install
   ```

3. 启动开发服务器：
   ```bash
   npm run dev
   ```

4. 在浏览器中打开 [http://localhost:3000](http://localhost:3000) 查看应用。

## 📁 项目结构

```text
├── frontend/                # Full-stack Next.js 16 应用
│   ├── src/
│   │   ├── app/             # Next.js App Router 页面和布局
│   │   │   └── api/         # 服务端 API routes（所有数据访问的唯一入口）
│   │   ├── server/          # 仅服务端代码：DB、认证、计费、通知、爬虫编排、
│   │   │                    #   意向/响应工作区、报价、风控、来源治理等 35+ 业务域
│   │   ├── components/      # React 组件 (UI 基础组件 + 业务组件)
│   │   ├── context/         # 全局状态管理 (如 SavedBidsContext)
│   │   ├── lib/             # 工具函数、类型定义、i18n 字典 (en/zh)
│   │   └── hooks/           # 自定义 React Hooks
│   ├── scripts/             # 迁移、seed、三个 worker、质量门禁与运维脚本
│   ├── data/                # 本地 SQLite 数据库与本地对象存储
│   └── package.json
├── crawler/                 # Python 招标数据采集引擎
│   ├── apsi_crawler/
│   │   ├── spiders/         # 41 个 spider 模块（州级门户 + SAM.gov + BidNet + Bonfire）
│   │   ├── sources/         # 数据源定义与治理元数据
│   │   ├── normalizers/     # 原始数据标准化
│   │   ├── storage/         # SQLite 写入与附件归档
│   │   └── cli.py           # CLI 入口：fetch-task / fetch-sam-gov / validate-state-live / import-fixture
│   ├── tests/               # pytest 测试套件 + fixtures
│   └── requirements.txt
├── docs/                    # 产品需求、运维手册、QA 报告、设计文档
└── docker-compose.yml       # 本地 demo 容器编排
```

## 🗓️ 演进路线

- **当前阶段（Phase 2 爬虫扩展 + 本地深化）**：BidNet 县市级数据源扩展（10 个种子源已上线）、Bonfire 平台适配、per-platform 并发控制、治理门禁强化；同时继续做 quote upload UI、XLSX parsing、award tabulation、outcome analytics 和 UI polish。
- **生产发布准备**：AWS/S3/RDS staging、Stripe sandbox/live、生产 email/CRM、backup/restore、production worker、source-health runner 和外部 malware scanning 仍需真实环境/凭证验证。
- **AI / Enterprise 后续阶段**：当前是 deterministic / AI-like foundation；真实 LLM、embedding/vector store、RAG、credit charging、Enterprise cockpit 深度仍是后续主线。

详细需求状态：

- `docs/product-requirements/README.md`
- `docs/product-requirements/winbids-implementation-status.md`
- `docs/product-requirements/winbids-next-development-plan.md`
- `docs/product-requirements/winbids-current-gap-analysis.md`

## 📄 许可证

All rights reserved.
