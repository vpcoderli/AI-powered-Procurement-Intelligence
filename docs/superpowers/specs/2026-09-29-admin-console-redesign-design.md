# 管理后台改版设计（2026-09-29）

## 1. 要解决的问题

用户 2026-09-29 提出三点：

1. 州、县、市、镇合计已有 1,020 个数据源，`/admin` 首页的信息源数字不准确，而且整页看上去仍然只围绕 50 个州。
2. `/admin` 不够清晰，要整体重新梳理功能板块：拆成多个子页面，用目录树导航。
3. 参照成熟的管理后台，让后台信息更好管理。

实测（本地 MySQL `winbids`，2026-09-29）：

| 级别 | 源数 | 已批准 | 待审批 | 已拦截 | 从未运行 |
| --- | --- | --- | --- | --- | --- |
| city | 554 | 1 | 552 | 1 | 553 |
| county | 266 | 7 | 257 | 2 | 258 |
| township | 144 | 0 | 144 | 0 | 144 |
| state（`jurisdiction_level` 为空，按 `issuer_type`） | 55 | 55 | 0 | 0 | 5 |
| federal（SAM.gov） | 1 | 1 | 0 | 0 | 0 |

招标 3,737 条（开放 3,705），用户 300 个，近 7 天抓取日志 8 条（全部成功）。

**数字为什么不准。** 首页四张卡片来自 `listAdminDataSources` 的汇总：总数 1,020、启用 1,012、"健康" 1,019、失败 1。"健康"的判定是"从没失败过"，于是 952 个还在治理拦截里、从未运行过的本地源全部被算成健康。页面上也没有按级别的分布，唯一按辖区展开的视图是风险检查里的 50 州数据质量矩阵，它来自静态的州门户登记表——这就是"还展示 50 个州"的来源。

**页面为什么难用。** `src/app/admin/page.tsx` 一个文件 4,403 行，上下堆了约十个板块：源指标卡、增长漏斗（标签是硬编码英文）、风险检查与州矩阵、配置矩阵、招标质检、用户、通知投递、用户审计日志、1,020 行的数据源表（每行内嵌预检、配置、审批面板）、抓取日志。每次打开都加载全部源和全部抓取日志，任何一个板块都无法单独链接或收藏。全局侧边栏里给管理员的入口是锚点（`/admin#data-sources`、`/admin#configuration`）。

## 2. 决策（用户 2026-09-29 确认）

1. **导航**：左侧目录树（成熟后台惯例）。
2. **概览**：四个板块全要——数据源覆盖、接入审批管道、抓取健康、招标数据。
3. **交付**：一次性完成（导航、概览、全部子页面、服务端分页的源列表、源详情页）。
4. **实现方案**：嵌套路由 + 共享布局（方案 A）。不采用"单页 + 侧边栏切标签"（方案 B），也不引入 refine / react-admin 等后台框架（方案 C）。
5. **菜单、路由与角色**：见第 3 节的表，原样确认。
6. **概览口径**：级别取 `jurisdiction_level`，为空时回退到 `issuer_type`；"在抓取计划内"= 通过调度器的审批门禁；平台暂停只存在于 worker 内存，网页不显示。
7. **源列表**：`GET /api/admin/data-sources` 改为服务端分页与筛选，去掉旧的"全量 + summary"响应；按辖区批量运行改用轻量索引接口。
8. **其余页面**：原有板块迁移到各自子页面，行为不变；州矩阵改名为"州级门户数据质量（50 个州）"；增长漏斗的硬编码英文进 i18n。

本文在确认之后补充的一项实现决定（第 3.2 节）：**只有一条左侧导航**。应用根布局已经用 `SidebarProvider` + `AppSidebar` 包住了所有页面；管理后台不再叠加第二条侧边栏，而是让同一个 `AppSidebar` 在 `/admin/**` 下切换成管理目录树。

## 3. 信息架构、路由与角色

### 3.1 菜单与路由

| 一级 | 二级 | 路由 | 内容 | 可见角色 |
| --- | --- | --- | --- | --- |
| 概览 | — | `/admin` | 四个指标板块（第 4 节） | admin、operator、support |
| 数据源 | 源列表 | `/admin/sources` | 服务端筛选、搜索、分页、批量操作（第 5 节） | 三者（操作按角色） |
| 数据源 | 源详情 | `/admin/sources/[id]` | 概况、抓取配置、预检与审批、运行记录、招标（第 6 节）；不出现在菜单里，由列表进入 | 三者（操作按角色） |
| 数据源 | 接入审批 | `/admin/sources/onboarding` | 平台审查面板、带台账批量批准面板（阶段 3 已建） | 三者（写操作沿用现有规则） |
| 数据源 | 抓取运行 | `/admin/sources/runs` | 按辖区批量运行、抓取日志 | admin、operator |
| 数据质量 | 州门户质量 | `/admin/quality` | 风险检查、州级门户数据质量（50 个州） | 三者 |
| 数据质量 | 招标质检 | `/admin/quality/bids` | 招标质检 | admin、operator |
| 用户权限 | 用户 | `/admin/users` | 用户、角色、功能覆盖 | admin |
| 用户权限 | 审计日志 | `/admin/users/audit` | 用户审计日志 | admin |
| 运营系统 | 通知投递 | `/admin/notifications` | 通知投递 | admin、operator |
| 运营系统 | 增长漏斗 | `/admin/growth` | 营销漏斗 | 三者 |
| 运营系统 | 配置 | `/admin/config` | 配置矩阵 | admin |

- 角色看不到的菜单项不渲染；页面本身仍按角色守卫，直接输入网址也拿不到数据（服务端路由的角色规则不变）。
- 角色取值沿用 `ADMIN_CONSOLE_ROLES`（admin / operator / support）。

### 3.2 一条左侧导航

- `AppSidebar`（`src/components/layout/app-sidebar.tsx`）在路径以 `/admin` 开头时显示管理目录树：顶部一项"返回前台"，下面按第 3.1 节分组，按当前用户角色过滤；当前页高亮，所在分组展开。
- 其他页面照旧；管理员看到的管理入口只保留一项"管理后台"（`/admin`），删掉两个锚点入口。
- 菜单定义放在一个配置文件里（项、图标、路由、角色、i18n 键），`AppSidebar`、面包屑和页面守卫都读它；"某角色可见哪些项"是一个纯函数。
- 窄屏沿用现有 `SidebarTrigger` 的收起行为。

### 3.3 管理布局

`src/app/admin/layout.tsx` 负责：

- 登录与角色门禁：沿用今天页面里的加载中、需要登录、无权限三种状态（`AdminAccessState`）。
- 页头：由菜单配置生成的面包屑与页面标题；刷新按钮由各页面自己放。

根布局已有语言切换，管理布局不重复。

## 4. 概览（`/admin`）

### 4.1 接口

新增只读路由 `GET /api/admin/overview`（`roles: ["admin", "operator", "support"]`），两种数据库各自用 SQL 聚合计算，不加载全部源与全部日志。响应：

```ts
type CoverageLevel = "federal" | "state" | "county" | "city" | "township" | "special_district" | "unknown";

interface AdminOverview {
  generatedAt: string;
  coverage: {
    totals: { sources: number; scheduled: number; awaitingApproval: number; neverRun: number };
    byLevel: Array<{
      level: CoverageLevel;
      total: number; enabled: number; approved: number; awaitingApproval: number; blocked: number; neverRun: number;
    }>;
    byState: Array<{ stateCode: string; total: number; byLevel: Partial<Record<CoverageLevel, number>> }>;
  };
  pipeline: Array<{
    providerFamily: string;
    platformReview: EffectivePlatformReview;          // 阶段 3 的有效审查规则
    counts: Record<ApprovalReadinessBucket, number>;  // 阶段 3 的六个分组
    queued: number;                                    // precheck_requested_at 非空的源数
    oldestQueuedAt: string | null;
  }>;
  crawlHealth: {
    runs24h: { success: number; failure: number; other: number };
    runs7d: { success: number; failure: number; other: number };
    lastRunAt: string | null;
    failingSources: number;
    worstFailing: Array<{ id: string; label: string; consecutiveFailures: number; lastFailureAt: string | null }>;
    throttleEvents24h: number;
  };
  bids: {
    open: number; closed: number; awarded: number;
    new24h: number; new7d: number;
    openByLevel: Partial<Record<CoverageLevel, number>>;
    pendingQa: number;
  };
}
```

### 4.2 口径

- **级别**：`COALESCE(jurisdiction_level, issuer_type)`；不在已知集合里的值记 `unknown`。与调度器门禁（`listCrawlableSources`）的回退规则一致。
- **在抓取计划内（scheduled）**：满足 `listCrawlableSources` 的同一组条件（启用、`approved_for_ingestion` 为空或 1、已批准或为联邦/州级且审批为空、法务状态允许）。两种数据库的谓词与现有实现共用或逐字对应，不另写一套。
- **待审批（awaitingApproval）**：本地级别（任何非 federal/state 的级别）且 `approval_status` 为空或 `needs_review`。
- **从未运行（neverRun）**：`last_success_at` 与 `last_failure_at` 都为空。
- **已批准 / 已拦截**：`approval_status = 'approved'` / `'blocked'`；州级门户按门禁规则（审批为空也在计划内）单独体现在 scheduled 里。
- **按州**：按 `state_code` 分组，每州再按级别细分；前端默认显示源数最多的 10 个州，可展开全部，可按列排序。
- **接入审批管道**：对每个有本地源的 `provider_family` 运行阶段 3 的就绪度规则（`summarizeApprovalReadiness` 同一套判定），输入只取治理相关列的轻量查询；平台审查状态取 `effectivePlatformReview`。
- **抓取健康**：`crawler_logs` 在最近 24 小时 / 7 天内按结果计数，排除 `source = 'attachment_repair'`；`lastRunAt` 取最近一次开始时间；失败源数 = 启用且 `consecutive_failures > 0`，列出最严重的 5 个；限流/挑战事件 = 最近 24 小时的失败日志里满足 `isPlatformThrottleSignature` 同一判定的条数。平台暂停状态只在 worker 内存里，页面写明"暂停状态见 worker 日志"。
- **招标数据**：按 `lifecycle_status` 计开放 / 截止 / 已授标；新增 = `created_at` 在窗口内；开放招标按来源级别分布（取招标所属源的级别，规则同上）；待质检 = 招标质检队列里待审核的条数（沿用 `bid-qa-repository` 的判定）。

### 4.3 页面

四个板块自上而下：数据源覆盖（四张总数卡 + 按级别表 + 按州表）、接入审批管道（每平台一行：审查状态与到期日、六个分组计数、队列长度与最早入队时间，点进"接入审批"页）、抓取健康（24 小时 / 7 天计数、最近一次运行、失败源 Top 5 链接到源详情、限流事件数）、招标数据（开放 / 截止 / 已授标、新增、按级别分布、待质检链接到"招标质检"页）。页头显示"数据生成于 hh:mm"和刷新按钮，不自动轮询。柱状比例用 CSS 条表示，不引入图表库。

## 5. 源列表（`/admin/sources`）

### 5.1 接口

`GET /api/admin/data-sources`（console 读角色）改为：

| 参数 | 含义 |
| --- | --- |
| `level` | 可重复；级别（同第 4.2 节规则） |
| `state` | 可重复；两位州码 |
| `platform` | `provider_family` |
| `approval` | `approved` / `awaiting`（本地源审批为空或 `needs_review`，即治理拦截中）/ `blocked` |
| `health` | `never_run` / `healthy` / `failing` / `disabled` |
| `q` | id、名称、辖区名包含（不区分大小写） |
| `sort` | `label` / `lastRun` / `failures` / `updated`，加 `-` 前缀为降序；默认 `label` |
| `page`、`pageSize` | 默认 1 / 50，`pageSize` 上限 200 |

响应 `{ items, total, page, pageSize, facets }`：

- `items` 是精简行：`id`、`label`、`stateCode`、级别、`jurisdictionName`、`providerFamily`、`approvalStatus`（阶段 3 的"本地源审批为空显示为待审核"规则）、`isEnabled`、`health`、`lastSuccessAt`、`lastFailureAt`、`consecutiveFailures`、`precheckRequestedAt`、`liveHealthDisposition`。不带日志、审批历史、健康趋势。
- `health` 的判定按优先级：`disabled`（未启用）> `failing`（`consecutive_failures > 0`）> `healthy`（`last_success_at` 非空）> `never_run`。
- `facets` 给每个筛选项的可选值与计数；每个维度的计数应用其他维度的当前筛选、不应用自己（常规分面）。

旧响应（全部源 + `summary`）删除；概览取代 summary。

**轻量索引** `GET /api/admin/data-sources/index?level=&state=`（admin、operator）：返回所有匹配源的 `id`、`label`、`stateCode`、级别、`providerFamily`、`approvalStatus`、`isEnabled`，供"抓取运行"页的按辖区批量运行选择整级或整州。

### 5.2 页面

- 筛选条（级别、州、平台、审批、健康，多选芯片带分面计数）+ 搜索框 + 排序；筛选、排序、页码都写在 URL 查询串里，可收藏、可分享、浏览器后退可用。
- 表格列：名称（链接到详情）、级别、州、平台、审批徽标、健康徽标、最近运行、连续失败、启用。
- 批量操作（勾选当前页若干行；按角色显示）：

| 操作 | 角色 | 走的接口 | 限制 |
| --- | --- | --- | --- |
| 预检入队 | admin、operator | 阶段 3 的 `POST /api/admin/data-sources/precheck-requests` | 也可"全部 N 个匹配项入队"：先取索引，每批 500 个 id |
| 带台账批准 | admin | `POST /api/admin/data-sources/batch`（approve） | 每批 100 个，结果按批准 / 跳过原因汇总 |
| 暂缓 | admin | 同上（hold） | 每批 100 个 |
| 立即运行 | admin、operator | `/api/crawler/state/run` | 一次最多 20 个 |

## 6. 源详情（`/admin/sources/[id]`）

### 6.1 接口

- 现有 `api/admin/data-sources/[id]/route.ts` 增加 `GET`（console 读角色）：返回完整的 `AdminDataSource`（审批历史、最近日志、健康），外加本源招标按状态的计数与最新 10 条招标（id、标题、发布日、截止日、状态）。
- `GET /api/admin/crawler-logs` 增加 `source` 过滤与游标分页（`before=<startedAt>`、`limit` 上限 100），两种数据库都实现。

### 6.2 页面

- 页头：名称、级别与州、审批与健康徽标；操作按钮（按角色）：立即运行、批准或暂缓（沿用现有规则：本地源的批准走台账对话框或批量面板）、启用或停用。
- 标签页：**概况**（id、辖区与 GEOID、`base_url`、平台、频率、状态、最近运行、失败次数）· **抓取配置**（现有 `CrawlerConfigPanel`）· **预检与审批**（现有 `SourcePrecheckPanel` 与 `ApproveLocalSourceDialog`、本源的就绪度判定与原因、审批历史）· **运行记录**（分页的抓取日志）· **招标**（计数与最新 10 条）。
- 源 id 不存在时显示"未找到"并链接回列表。

## 7. 其余页面

| 页面 | 来源 | 变化 |
| --- | --- | --- |
| 接入审批 | 阶段 3 的 `PlatformReviewsPanel`、`LedgeredApprovalPanel` | 移入本页，行为不变 |
| 抓取运行 | `JurisdictionBatchRunPanel`、抓取日志表 | 批量运行改用第 5.1 节的轻量索引 |
| 州门户质量 | 风险检查、`StateDataQualityMatrix` | 标题改为"州级门户数据质量（50 个州）" |
| 招标质检 | 招标质检板块 | 行为不变 |
| 用户 / 审计日志 | 用户板块、用户审计日志 | 行为不变 |
| 通知投递 | 通知投递板块 | 行为不变 |
| 增长漏斗 | 营销漏斗 | 硬编码英文标签进 i18n |
| 配置 | 配置矩阵 | 仅 admin |

## 8. 前端结构

- `src/app/admin/layout.tsx`：门禁与页头（第 3.3 节）。
- 路由：`src/app/admin/page.tsx`（概览）、`sources/page.tsx`、`sources/[id]/page.tsx`、`sources/onboarding/page.tsx`、`sources/runs/page.tsx`、`quality/page.tsx`、`quality/bids/page.tsx`、`users/page.tsx`、`users/audit/page.tsx`、`notifications/page.tsx`、`growth/page.tsx`、`config/page.tsx`。每页是薄壳，只取自己的数据。
- 今天大页面里的板块抽成 `src/components/admin/sections/*`（每个板块一个文件）；徽标色调与标签等共用函数抽成一个格式化模块。
- 菜单配置与"按角色可见"函数：`src/components/admin/admin-nav.ts`（`AppSidebar`、面包屑、页面守卫共用）。
- 列表的筛选状态放在 URL；不引入全局状态库。
- 客户端 API 放在 `src/lib/api/admin.ts`（新增概览、分页列表、索引、详情、按源分页日志的函数）。

## 9. 服务端结构

- 概览：一个模块，SQLite（Drizzle）与 MySQL（手写 SQL）两条分支，命名 `getAdminOverview` / `getAdminOverviewFromMysql`。
- 分页列表：一个模块，负责参数解析与校验、筛选、排序、分页与分面，两条分支。
- 新路由：`api/admin/overview/route.ts`（console 读）、`api/admin/data-sources/index/route.ts`（admin、operator）；`api/admin/data-sources/route.ts` 改为分页；`[id]/route.ts` 加 `GET`；`crawler-logs` 加过滤与游标。全部登记到 `role-route-coverage.test.ts`，并满足 `mysql-route-coverage.test.ts`。
- 不改阶段 3 的治理规则与写接口。

## 10. 错误处理

- 每页用现有的加载中 / 出错（带重试）/ 空状态卡片；403 显示无权限状态；未登录由布局处理。
- 分页参数非法（未知筛选值、页码越界、`pageSize` 超限）返回 400 `INVALID_REQUEST`，前端回退到默认参数并提示。
- 概览某个板块的查询失败不拖垮整页：接口按板块返回，失败的板块显示出错卡片。

## 11. i18n

- 所有新文案（菜单、页面标题、指标名、筛选项、空状态）同时进 `en.ts` 与 `zh.ts`，中文不得与英文逐字相同。
- 增长漏斗的五个硬编码英文标签改为字典键。
- `npm run i18n:check` 只扫 `src/app`；组件里的文案一律走字典。

## 12. 测试与验收

**自动化测试**

- 菜单按角色可见（纯函数）；URL ↔ 筛选状态的解析与序列化（纯函数）。
- 概览聚合：SQLite 用 `createTestDatabase` 造出各级别、各审批状态、各健康状态的源与日志、招标，逐项核对计数；MySQL 用假的 `{ query, execute }` 断言 SQL 与参数。
- 分页列表：筛选、搜索、排序、分页、分面在两种数据库上的行为；非法参数的 400。
- 路由：角色、方法、登记表；详情 `GET`、索引、按源分页日志。
- `AppSidebar`：`/admin/**` 下显示目录树、其他路径不显示锚点入口。
- 原有 `src/app/admin/page.test.ts(x)` 按页面拆分；`next build` 作为类型门槛；lint、i18n 扫描。

**验收（在本地 MySQL `winbids` 上）**

- 概览的按级别表与第 1 节的实测表一致；"健康"不再把从未运行的源算进去。
- 源列表能分页浏览 1,020 个源，分面计数与筛选结果一致。
- 每个页面只请求自己的接口；没有页面再加载全部抓取日志。
- 旧的锚点入口已被真实路由取代；三个角色看到的菜单与第 3.1 节一致。
- 用已登录的管理员会话在浏览器里逐页走一遍（本地开发服务器）。

## 13. 边界（不做）

- 不引入新的 UI 库、后台框架或图表库。
- 不做自动刷新 / 实时推送；不把 worker 的平台暂停状态写入数据库。
- 不改阶段 3 的治理规则、批准写入与预检队列逻辑。
- 不做移动端专门的重新设计（沿用侧边栏收起）。

## 14. 依赖与顺序

- 在阶段 3（`feat/county-phase3-governance`）合入 `main` 之后，从 `main` 新开分支实施；本设计的子页面直接复用阶段 3 的面板与接口。
- 实施计划另写（`docs/superpowers/plans/`），多 subagent 执行。
