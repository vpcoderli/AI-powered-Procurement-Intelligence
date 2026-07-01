# APSi GovBid (AI-powered Procurement Intelligence)

APSi GovBid 是一个致力于帮助供应商（特别是中小企业）高效检索、筛选和管理政府招标信息的智能聚合平台。

本项目目前处于 **本地可用 MVP 深化阶段**。当前系统已从“招标信息聚合与检索”扩展到账号/权限、50 州数据校验、采购意向工作台、响应工作区、材料库、报价、提醒、Award / Win-Loss Lite、营销漏斗、MySQL 本地运行和生产发布准备文档。

当前统一进度以 `docs/product-requirements/winbids-implementation-status.md` 为准：

- 本地可用 MVP：约 **98%**。
- 生产发布准备：约 **73%**。
- 商业化闭环：约 **73%**。
- 公开营销首页 / 获客漏斗：约 **94%**。
- 采购工作流深度：约 **93%**。
- AI / Enterprise 深度：约 **60%**。
- 完整 PRD / 长期平台：约 **76%**。

## ☁️ AWS 发布应用名称

- **建议展示名称**：`APSi GovBid`
- **建议 AWS Application Name**：`apsi-govbid`
- **环境命名示例**：`apsi-govbid-dev`、`apsi-govbid-staging`、`apsi-govbid-prod`

## 🌟 核心价值

美国各州县政府的招标信息高度分散在数十个不同的门户网站中，导致供应商检索效率极低。APSi 旨在打造一个统一的招标信息检索平台，初期整合 50 个州及联邦政府（SAM.gov）的公开招标信息，为用户提供一站式的数据访问体验。

## ✨ 主要功能

- **统一检索**：支持对招标标题和描述进行全文模糊搜索。
- **50 州数据与安全详情路由**：本地 deterministic release gate 覆盖 50/50 州、1,146 条 active state bids、216 条安全本地附件下载路由，并拒绝 placeholder / 404 证据链接。
- **账号、角色、套餐权限**：支持普通用户注册登录、Admin/普通用户分离、Free / Pro / Business / Enterprise 功能 gate、locked/upgrade 状态和本地 paid smoke。
- **采购意向工作台**：支持 Intent 创建、资格评估、Compliance、Submission、Pursue / No-Bid、Response Workspace、Artifact Vault、Quote Workspace、Deadline Reminders。
- **响应包与材料库**：支持 Markdown/ZIP/PDF/DOCX 本地导出、导出审核状态、版本历史、对比、材料替换/version、checksum/byte-size 校验。
- **Quote / Award / Win-Loss Lite**：支持报价请求、报价比较摘要、CSV/JSON quote parser lite、Award outcome、Win/Loss learning summary。
- **Dashboard / Admin Ops**：支持角色化 Dashboard、Product 6 intelligence lite、Admin source health、risk check、Config Matrix、Marketing Content CMS lite、funnel metrics。
- **中英双语支持**：内置 i18n，可全局切换中文和英文界面。
- **MySQL 本地运行**：SQLite 仍可用于轻量本地开发；MySQL runtime、migration、smoke、worker preflight、risk gate 已完成本地验证。

## 💻 技术栈

本项目前端和本地后端采用现代 Web 技术栈构建：

- **框架**: [Next.js 15](https://nextjs.org/) (App Router) + React 19
- **样式**: Tailwind CSS v4 + 极简主义设计规范
- **组件库**: [shadcn/ui](https://ui.shadcn.com/) (基于 Radix UI)
- **图标**: Lucide React
- **数据层**: SQLite 本地开发 + MySQL 本地/类 staging 运行路径
- **本地文件/对象存储**: local object storage abstraction + S3-compatible posture preflight
- **状态管理**: React Context + typed API helpers
- **语言**: TypeScript

## 🚀 快速开始

### 环境要求

- Node.js 18+ 
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
frontend/
├── src/
│   ├── app/               # Next.js App Router 页面和布局
│   ├── components/        # React 组件 (包含 UI 基础组件和业务组件)
│   ├── context/           # 全局状态管理 (如 SavedBidsContext)
│   ├── lib/               # 工具函数、Mock 数据、i18n 字典
│   └── hooks/             # 自定义 React Hooks
├── public/                # 静态资源
└── package.json           # 项目依赖和脚本
```

## 🗓️ 演进路线

- **当前本地阶段**：继续做 50 州 P1 warning closure、quote upload UI、XLSX parsing、award tabulation、outcome analytics、deep Enterprise cockpit、full CMS editing 和浏览器级 UI polish。
- **生产发布准备**：AWS/S3/RDS staging、Stripe sandbox/live、生产 email/CRM、backup/restore、production worker、source-health runner 和外部 malware scanning 仍需真实环境/凭证验证。
- **AI / Enterprise 后续阶段**：当前是 deterministic / AI-like foundation；真实 LLM、embedding/vector store、RAG、credit charging、Enterprise cockpit 深度仍是后续主线。

详细需求状态：

- `docs/product-requirements/README.md`
- `docs/product-requirements/winbids-implementation-status.md`
- `docs/product-requirements/winbids-next-development-plan.md`
- `docs/product-requirements/winbids-current-gap-analysis.md`

## 📄 许可证

All rights reserved.
