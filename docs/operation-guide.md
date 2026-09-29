# APSi 本地操作说明

本文档用于本地开发、演示和功能验收。所有命令默认从项目根目录进入 `frontend` 后执行。

## 1. 启动前准备

环境要求：

- Node.js 18+
- npm
- Python 3，用于运行州级和 SAM.gov 爬虫

进入前端目录：

```bash
cd frontend
```

安装依赖：

```bash
npm install
```

初始化数据库表：

```bash
npm run db:migrate
```

写入演示数据：

```bash
npm run db:seed
```

默认 SQLite 数据库位置：

```text
frontend/data/apsi.sqlite
```

## 2. 启动系统

开发模式启动：

```bash
npm run dev
```

浏览器访问：

```text
http://localhost:3000
```

如果 3000 端口被占用，Next.js 会提示换端口；按终端输出的地址访问即可。

## 3. 页面入口

主要页面：

- 首页：`/`
- 搜索招标：`/search`
- 已保存招标：`/saved`
- 设置：`/settings`
- 管理后台：`/admin`
- 静态 UI/UE 方案页：`/generative-art-static`

静态 UI/UE 方案页是独立展示页，只用于设计评审；它不会调用 API、不会触发爬虫，也不会修改现有业务数据。

## 4. 基础使用流程

### 搜索招标

1. 打开 `/search`。
2. 输入关键词，例如 `cloud`、`cybersecurity`、`AI`。
3. 按州、发布时间、截止时间、来源类型筛选。
4. 点击招标卡片进入详情页。

### 查看详情

1. 在搜索结果中点击任意招标。
2. 查看标题、描述、发布机构、金额、截止日期、联系方式和原始来源链接。
3. 如有附件，检查附件列表和来源地址。

### 保存招标

1. 在招标列表或详情页点击保存按钮。
2. 打开 `/saved` 查看已保存内容。
3. 再次点击保存按钮可取消保存。

匿名用户和登录用户都可以保存；登录或注册后，匿名保存内容会合并到当前账号。

### 中英文切换

1. 使用页面顶部的语言切换控件。
2. 选择 `en` 或 `zh`。
3. 系统会把语言选择保存到浏览器本地存储。

## Phase 1A 投标意向流程

1. 打开 `/profile`，完善供应商资料。
2. 打开 `/search`，选择一个招标机会。
3. 进入招标详情页，查看匹配分数和说明。
4. 点击 `Add to Intent` / `加入投标意向`。
5. 打开 `/intents`，选择新生成的投标意向工作台。
6. 查看 AI 摘要、检查清单、风险提示和关键日期。

## Submission Guidance Lite

该阶段为每个投标意向生成轻量提交指导，帮助确认外部门户、联系人、注册、纸质提交、补遗确认和提交复杂度。

本地数据库需要先执行迁移：

```bash
npm run db:migrate
```

已支持的接口：

- `GET /api/intents/:id/submission`：读取或生成提交指导。
- `PATCH /api/intents/:id/submission`：更新提交方式、门户地址、联系人和提交要求标记。
- `POST /api/intents/:id/submission/confirm`：保存外部提交后的人工确认记录。

注意：

- WinBids 不直接提交投标。
- 第三方门户登录、上传文件和最终提交仍需要用户在外部系统完成。
- 当前提交指导使用确定性规则生成，不调用 LLM。

## 5. 管理后台与爬虫

打开管理后台：

```text
http://localhost:3000/admin
```

本地开发可使用管理绕过：

```bash
ADMIN_UI_LOCAL_BYPASS=true npm run dev
```

手动运行爬虫的接口（`POST /api/crawler/state/run` 等）需要 admin / operator 会话（后台按钮走的就是这个会话；本地开发的管理绕过只对 localhost 请求有效）；配置了 `CRAWLER_RUN_TOKEN` 时，带上匹配的 `Authorization: Bearer <token>` 或 `x-crawler-token` 头也可以调用。不带会话也不带 token 的调用只在同时满足这些条件时放行：没有配置 `CRAWLER_RUN_TOKEN`、`NODE_ENV` 为 development/test、请求来自 localhost，并且设置了 `CRAWLER_ALLOW_UNAUTHENTICATED_LOCAL_RUN=true`（见 `frontend/src/server/crawler/run-authorization.ts`）。

### 运行全部州级爬虫

在 `/admin/sources/runs`（抓取运行，仅 admin / operator 可见）页面点击"运行州级爬虫"按钮，不指定来源，调用 `POST /api/crawler/state/run`。按钮虽叫州级，它运行的是**当前每一个可抓取的非联邦来源**，不是固定的几个州：通过治理门禁的州级门户，加上已经批准的县/市/镇等本地来源（包括已批准的 BidNet 县/市源）。尚未批准的县/市/镇来源、被暂缓或拦截的来源、已停用的来源、法务审查不允许的来源不在其中；联邦的 SAM.gov 也不在其中，它有自己的入口 `POST /api/crawler/sam-gov/run`。

数量随批准与停用变化。概览（`/admin`）里"在抓取计划内"的数字就是这个集合再加上联邦来源：2026-09-30 的本地库里是 59，即这次会运行约 58 个来源（州级来源加已批准的 BidNet 县/市源）。来源按顺序一个接一个运行，要跑一段时间。这一次运行**不占** crawler worker 的每小时平台请求预算（`CRAWLER_PLATFORM_BUDGETS`），也不受 worker 内存里的平台暂停约束，只适用本次批量内部的平台推迟：同一 `provider_family` 的两个来源至少间隔 `CRAWLER_PLATFORM_MIN_INTERVAL_MS`（默认 5 秒），其中一个遇到挑战/限流后，本批里同平台剩下的来源记为 `deferred`（推迟），不会被访问。

运行后，该页面会刷新下方的爬虫日志；数据源状态可在 `/admin/sources`（源列表）查看。

也可以使用脚本运行一次完整爬虫流程：

```bash
npm run crawler:once
```

### 按州单独运行

在 `/admin/sources`（源列表）里点进某个来源的详情页（`/admin/sources/[id]`），点击"立即运行"即可单独运行该来源；也可以在源列表勾选多个来源（一次最多 20 个）后点击"立即运行"（两处都仅 admin / operator 可见）。适用于某个州失败、数据过旧或需要单独补跑的情况。

### 定时爬虫 worker

启动后台 worker：

```bash
npm run worker:crawler
```

默认每 15 分钟运行一次。可通过环境变量调整间隔：

```bash
CRAWLER_WORKER_INTERVAL_MS=300000 npm run worker:crawler
```

上例为每 5 分钟运行一次。

### 生产 billing 与通知 worker

生产 billing、Stripe webhook 轮换、定时 worker 部署、dunning 提醒和 provider dashboard checklist 见：

```text
docs/operations/production-billing-worker-runbook.md
```

通知 worker 上线前可先做环境预检：

```bash
npm run worker:notifications:check
```

### 控制每个州抓取数量

可用 `STATE_CRAWLER_LIMIT` 控制州级爬虫单次抓取数量：

```bash
STATE_CRAWLER_LIMIT=10 npm run crawler:once
```

### 通知投递 worker

通知 outbox 默认使用本地 file provider，把待发送 payload 写到 `frontend/data/notification-outbox`，便于本地检查。

运行一次通知调度和投递：

```bash
NOTIFICATION_WORKER_RUN_ONCE=1 npm run worker:notifications
```

生产邮件 provider、fallback、失败重试和排障步骤见 `docs/operations/notification-delivery-runbook.md`。

## 6. 静态 UI/UE 方案页

访问：

```text
http://localhost:3000/generative-art-static
```

用途：

- 展示基于 UI UX Pro Max Generative Art Platform 风格重新设计的 APSi 静态界面。
- 评审新的视觉方向、信息架构和交互质感。
- 为后续改造 Search、Saved、Admin、Settings 等真实页面提供参考。

注意：

- 该页面没有真实按钮行为。
- 不读取数据库。
- 不调用 `/api/`。
- 不运行爬虫。
- 不影响现有系统页面。

## 7. 常用开发检查

运行测试：

```bash
npm test
```

运行 lint：

```bash
npm run lint
```

生产构建：

```bash
npm run build
```

构建成功后，可用以下命令启动生产模式：

```bash
npm run start
```

## 8. 常见问题

### 页面没有数据

先确认已执行：

```bash
npm run db:migrate
npm run db:seed
```

然后重启开发服务器。

### 管理后台无法进入

本地开发时使用：

```bash
ADMIN_UI_LOCAL_BYPASS=true npm run dev
```

生产环境不应开启该变量。

### 爬虫运行后数据仍然很少

可能原因：

- 当前州级门户返回结果本身较少。
- `STATE_CRAWLER_LIMIT` 设置太低。
- 远程门户请求失败，系统使用 fixture fallback。
- SAM.gov 或州级门户需要额外网络/API 条件。

可在 `/admin/sources`（源列表）查看数据源状态，在 `/admin/sources/runs`（抓取运行）或某个来源详情页的"运行记录"标签查看最近爬虫日志；`/admin`（概览）汇总近 24 小时与近 7 天的抓取成败。

### 端口 3000 打不开

检查开发服务器是否仍在运行；如果终端提示换端口，请访问终端显示的新地址。

### 想重置本地数据

停止开发服务器后删除本地数据库文件：

```bash
rm -f data/apsi.sqlite data/apsi.sqlite-shm data/apsi.sqlite-wal
```

然后重新执行：

```bash
npm run db:migrate
npm run db:seed
```

## 9. 推荐验收顺序

1. 启动系统并打开首页。
2. 进入 `/search`，搜索并筛选招标。
3. 打开招标详情页。
4. 保存一个招标并在 `/saved` 查看。
5. 切换中英文。
6. 使用 `ADMIN_UI_LOCAL_BYPASS=true npm run dev` 进入 `/admin`。
7. 运行单个州级爬虫。
8. 运行全部州级爬虫。
9. 查看数据源状态和爬虫日志。
10. 打开 `/generative-art-static` 评审新 UI/UE 方向。
11. 打开任一 Intent 工作台，调用 Submission Guidance 接口验证提交指导基础层。
