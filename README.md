# APSi (AI-powered Procurement Intelligence)

APSi 是一个致力于帮助供应商（特别是中小企业）高效检索、筛选和管理政府招标信息的智能聚合平台。

本项目目前处于 **MVP (Minimum Viable Product)** 阶段，核心聚焦于“招标信息的聚合与检索”。

## 🌟 核心价值

美国各州县政府的招标信息高度分散在数十个不同的门户网站中，导致供应商检索效率极低。APSi 旨在打造一个统一的招标信息检索平台，初期整合 50 个州及联邦政府（SAM.gov）的公开招标信息，为用户提供一站式的数据访问体验。

## ✨ 主要功能 (MVP 阶段)

- **统一检索**：支持对招标标题和描述进行全文模糊搜索。
- **多维过滤**：按地区（全美/特定州）、发布时间、截止日期、发布机构类型（Federal/State）进行筛选。
- **招标详情展示**：提供完整的招标文本描述、原始来源链接和联系人信息。
- **收藏与保存**：用户可将感兴趣的招标标记为“收藏”，并在专属的“Saved Bids”页面进行管理。
- **中英双语支持**：内置完善的 i18n 国际化支持，可全局切换中文和英文界面。
- **支付网关极简主义 UI**：前端采用 Payment Gateway Minimalism 风格，具有高对比度、清晰的数据层级和极佳的易读性（Trust & Authority）。

## 💻 技术栈

本项目前端部分采用了现代化的 Web 技术栈构建：

- **框架**: [Next.js 15](https://nextjs.org/) (App Router) + React 19
- **样式**: Tailwind CSS v4 + 极简主义设计规范
- **组件库**: [shadcn/ui](https://ui.shadcn.com/) (基于 Radix UI)
- **图标**: Lucide React
- **状态管理**: React Context (用于多语言和收藏夹状态)
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

- **Phase 1 (MVP)**：完成招标信息的基础聚合、多维检索、收藏功能与前端极简 UI 的实现。*(当前阶段)*
- **Phase 2**：引入后端数据采集引擎，实现各州门户及 SAM.gov 数据的自动化爬取与定时更新。
- **Phase 3**：引入 AI 能力，支持对招投标文件/附件的深度解析、历史数据分析和价格竞争分析。

## 📄 许可证

All rights reserved.