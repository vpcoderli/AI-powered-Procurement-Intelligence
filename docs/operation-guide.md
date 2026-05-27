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

## 5. 管理后台与爬虫

打开管理后台：

```text
http://localhost:3000/admin
```

本地开发可使用管理绕过：

```bash
ADMIN_UI_LOCAL_BYPASS=true npm run dev
```

如果配置了 `CRAWLER_RUN_TOKEN`，调用爬虫 API 时需要提供 token；未配置时，本地接口允许直接运行。

### 运行全部州级爬虫

在 `/admin` 页面点击运行州级爬虫按钮，可触发以下州级来源：

- California Cal eProcure
- Texas ESBD
- New York State Contract Reporter
- MyFloridaMarketPlace
- Illinois BidBuy

运行后，管理后台会刷新数据源状态和爬虫日志。

也可以使用脚本运行一次完整爬虫流程：

```bash
npm run crawler:once
```

### 按州单独运行

在 `/admin` 的数据源表格中，支持对单个州级来源点击运行按钮。适用于某个州失败、数据过旧或需要单独补跑的情况。

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

### 控制每个州抓取数量

可用 `STATE_CRAWLER_LIMIT` 控制州级爬虫单次抓取数量：

```bash
STATE_CRAWLER_LIMIT=10 npm run crawler:once
```

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

可在 `/admin` 查看数据源状态和最近爬虫日志。

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
