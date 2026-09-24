# 招标生命周期、BidNet 翻页与平台预算

设计与决策见[县/市/镇招标数据补全：设计](../superpowers/specs/2026-09-24-county-data-completeness-design.md)第 5 节；采集与详情补全的完整链路见[爬虫与 Scrapling 详情补全：全链路逻辑](../architecture/crawler-enrichment-flow.md)；县/市/镇源的审批门禁见[县/市级数据源的治理拦截、前置检查与批准](./local-source-approval.md)。本文只讲阶段 1 新增的六件事：招标状态怎么流转、BidNet 怎么翻页、会员锁怎么标注、平台请求预算怎么算、源怎么按活跃度分层、`township` 是什么。

## 1. 招标状态：open → closed → awarded

`bids.lifecycle_status` 三个取值（`frontend/src/lib/bid-lifecycle.ts` 的 `BID_LIFECYCLE_STATUSES`）：

- **`open`**：该招标当前仍在源租户的开放列表上；
- **`closed`**：截止日已过，或者在 closed 列表上被看到且没有中标记录；
- **`awarded`**：在 awarded 列表上被看到过，或者之前已经中标——一旦到过 `awarded` 就不会再被降回 `closed`：合并逻辑（`frontend/src/server/crawler/lifecycle.ts` 的 `mergeLifecycleFields()`）里，已有记录是 `awarded` 时，即使这次抓到的是 `closed` 也保持 `awarded`。

`is_active` 恒等于 `lifecycle_status === "open"`（open 是 1，closed/awarded 都是 0）。这是历史列，搜索、保存搜索提醒匹配器等继续只读 `is_active`，不需要感知三态。

**"已下架"是怎么判定的。** 只有当一次**开放列表**（`list_kind = "open"`）运行 `status = "success"` 且 `metadata.pagination.complete = true` 时，导入器才会把该源本次没有出现的其余 `open` 招标批量置为 `closed`，并在 `raw_payload.lifecycle` 里记 `closed_reason = "delisted"`、`closed_observed_at`（判定逻辑是 `lifecycle.ts` 的 `delistingApplies()`；下架动作是 SQLite/MySQL 各自的 `delistMissingOpenBids()`，在同一个入库事务里做）。失败的运行、被 `limit` / `query` / `max_pages` 截断的运行、套了发布日期过滤（`date_range`）的运行——`complete` 都不是 `true`，因此都不会做这次"清缺"下架；本次实际抓到的招标仍然正常写入或更新，只是不会因为"这次没在列表里看到"就被认定下架。"该源的招标"按 bid id 前缀 `<source_id>:` 圈定（`sourceBidIdLikePattern()`：`LIKE '<source_id>!:%' ESCAPE '!'`，`!` 转义 source_id 里本来就有的 `!`、`%`、`_`）。

查一个源的状态分布：

```sql
SELECT lifecycle_status, COUNT(*) FROM bids WHERE id LIKE 'bidnet!_co!_denver:%' ESCAPE '!' GROUP BY 1;
```

## 2. 翻页：BidNet 按"下一页"走

`crawler/apsi_crawler/list_extraction.py` 的 `run_paginated_list_extraction()` 驱动翻页，`crawler/apsi_crawler/spiders/co_bidnet.py` 的 `bidnet_next_page()` 从页面的分页区块读出"下一页" URL 和页码。三种列表（`open` / `closed` / `awarded`，即 BidNet 的 `open-bids` / `closed-bids` / `awarded-bids` 三个公开页面）都走同一套翻页逻辑；`open` 列表第 1 页就是源里存的 `base_url` 本身，字节不变。

默认每次运行最多翻 4 页（`DEFAULT_LIST_PAGES = 4`），单源可在 `fetch_config.list_pages` 里按 1–50 调整（越界或非整数一律回退默认值 4，见 `frontend/src/server/crawler/state-runner.ts` 的 `listPagesFor()`；Python 侧 `resolve_pagination_request()` 做同样的夹取，上限 `MAX_LIST_PAGES = 50`）。BidNet 源的 `limit: null` 表示不设条数上限，翻页只受 `max_pages` 约束；非翻页的适配器行为不变（没有 `metadata.pagination`，默认 `limit = 25`）。

Scrapling 仍是列表解析的主路径：抓到的每一页 HTML 交给抽取 sidecar 的 `POST /extract-list`。适配器自己的"页面读取器"（`page_reader`，`read_bidnet_list_page()`）在两条路径下都会跑一次，但只用来补 `solicitation_number`、`region`、`lifecycle_status`、`list_kind`、`detail_access` 和下一页信息，**不会额外发请求**——一页只抓一次。翻页固定走适配器自己的请求方法（沿用 BidNet 的 3 秒请求间隔），即使源配置了 `list_extraction.render: true` 也不会改走浏览器渲染 sidecar：翻页一次运行的请求数远高于单页阶段，改走渲染正好是触发 WAF 挑战的"密集连续扫段"。

一次翻页会因为下面任一原因停止（`metadata.pagination.stopped_reason`）：

| `stopped_reason` | 含义 |
| --- | --- |
| `exhausted` | 翻到没有"下一页"链接的最后一页，正常走完 |
| `max_pages` | 达到 `max_pages` 上限而停止 |
| `window` | 命中 `stop_before` 历史回补日期窗口——整页招标都早于该日期 |
| `limit` | 收集到的招标数达到了调用方指定的 `limit` |
| `unreadable_page` | 某一页的页面读取器一行都没读出来（可能是页面结构变了，也可能抓到了中间的空白页）。该页 Scrapling 自己解析出的行仍会保留，但翻页立即停止，这次运行永远不算 `complete` |
| `repeated_page` | "下一页"链接指回了已经抓过的页面，防止死循环 |

只有翻页**自然走到底**（`stopped_reason = "exhausted"`）、从第 1 页开始、每一页 Scrapling 解析出的招标 id 与该页读取器看到的 id 完全一致、没有被 `limit` / `query` 截断、第 1 页打印的总数（例如页面上的"97 Open Solicitations"）每一页都一致且等于收集到的不重复招标数、第 1 页 `<title>` 确实是本租户名字（源 label 去掉"(Platform)"后缀和结尾", XX"州码后逐字比较）——这些条件同时满足时 `metadata.pagination.complete` 才是 `true`。第 1 节的下架动作只在 `complete = true` 时触发。

## 3. 会员锁：BidNet 详情页锁住的字段

BidNet 把发标机构、正文、招标文件、采购联系人这四类信息锁在会员登录之后（`crawler/apsi_crawler/spiders/co_bidnet.py` 的 `BIDNET_DETAIL_ACCESS = {"restricted": ["description", "documents", "contact"], "platform": "BidNet"}`，写进每条招标记录的 `raw_payload.detail_access`）。APSi 不注册 BidNet 账号、不登录、不代抓这些字段——库里这些字段本来就是空的，不是抓取失败。

前端在 `frontend/src/lib/bid-access.ts` 的 `detailAccessFromRawPayload()` 里解析 `raw_payload.detail_access`；招标详情页正文位置由 `frontend/src/components/bids/BidAccessNotice.tsx` 渲染一条带锁形图标的提示条，中文文案固定为"{fields}仅对 {platform} 注册会员开放。"（字段名依次是"正文"、"招标文件"、"采购联系人"，用"、"连接），旁边一个新窗口打开的"在 {platform} 查看"按钮跳到 `source_url`。文案 key 在 `detail.restrictedAccessBody` / `detail.restrictedField_description` / `_documents` / `_contact` / `detail.restrictedFieldSeparator` / `detail.viewOnPlatform`，中英文字典必须同步（`npm run i18n:check`）。

## 4. 平台请求预算

`CRAWLER_PLATFORM_BUDGETS` 按"平台每小时请求数"配置，格式 `bidnet=60,bonfire=30`，某个平台写 `unlimited` 表示不设上限；不设该变量时只有 `bidnet` 有默认预算（`frontend/src/server/crawler/platform-budget.ts` 的 `DEFAULT_PLATFORM_BUDGETS = { bidnet: 60 }`）。没有被预算表覆盖的平台不受这套机制约束，沿用旧的"每 tick 每平台最多 10 个源"并发上限；受预算约束的平台从这个并发上限里排除（预算本身就是限流器，不需要再叠加并发上限）。

每个 tick 能花的额度 = `⌊平台每小时额度 × tick 时长 ÷ 1 小时⌋`，下限 1（`PlatformTickBudget`）。worker 默认一个 tick 15 分钟（`DEFAULT_TICK_MS`，跟 `CRAWLER_WORKER_INTERVAL_MS` 是同一个值），按公式默认每 tick 给 `bidnet` 15 次请求额度。每个源开跑前按它这次最多会翻的页数（`listPagesFor()`，默认 4）预扣额度，跑完后按实际 `metadata.pagination.requests_made`（翻页次数 + 详情补全请求数）多退少补。额度不够时这个源本 tick 直接跳过——不算失败、不占重试次数，下一个 tick 还会正常排上。

`npm run crawler:once` 和 `worker:crawler` 走同一个 `runConfiguredCrawlerSourcesOnce()`，因此同样受这套预算约束，不存在"批量跑一次就不受限"的例外通道。

一个平台的某个源被 WAF 挑战或限流命中一次后（`isPlatformThrottleSignature`），整个平台暂停 `CRAWLER_PLATFORM_PAUSE_MS`（默认 30 分钟）；暂停状态保存在 worker 进程内存里（`PlatformPauseRegistry`），跨 tick 生效但重启即丢。暂停期间到期的源同样不算失败，下次到期继续排。

被跳过的源按平台汇总成一条结构化日志：

```json
{"event": "crawler_platform_sources_skipped", "family": "bidnet", "paused": 0, "budget": 4}
```

`paused` 是因为平台处于暂停期跳过的源数，`budget` 是额度不够跳过的源数。

## 5. 活跃度分层

`data_sources.consecutive_empty_runs`：每次成功运行后回写（`frontend/src/server/crawler/source-health-repository.ts` 的 `recordSourceSuccess` / `recordSourceSuccessInMysql`）——运行被判定为"已验证空态"（`metadata.emptyState`，参见[治理拦截运维](./local-source-approval.md)第 4.1 节）就 `+1`；只要成功运行**看到了**开放招标（非空态成功）就直接清零。

对 `county` / `city` / `township` / `special_district` 四类地方级源（`LOCAL_JURISDICTION_LEVELS`）：只要最近一次成功运行看到过开放招标，就按源自身的 `cadence` 正常跑（默认每天）；一旦连续 3 次（`QUIET_SOURCE_EMPTY_RUNS = 3`）成功运行都判定为已验证空态，调度间隔放宽到至少每周（`frontend/src/server/crawler/scheduler.ts` 的 `effectiveIntervalMs()`：取 `max(cadence 对应间隔, 7 天)`）；这之后只要有一次运行看到了招标（计数器清零、掉回 3 以下），下次判定就立刻恢复原来的 cadence。`state` / `federal` 级源不受这条限制。

## 6. `township` 辖区级别

`township` 是阶段 1 新增的合法 `jurisdiction_level` 取值（commit `c7d30b4`），用于 Township，以及 NY/新英格兰/WI 这些州里叫"town"的建制（跟其他州"Town of X"实际是建制市镇、应归 `city` 不同）。真正把机构名分类成 `township` 的规则是阶段 2 的工作（`discover-sources` 的 `classify_agency`，见设计文档第 6 节）；阶段 1 只是先把这个级别接入枚举和调度：`register-sources.ts` 的合法级别集合、`scheduler.ts` 的辖区排序（`federal, state, county, city, township, special_district`）和活跃度分层集合、管理端批量运行面板的级别下拉与计数、批准对话框、中英文标签（"Township / town" / "镇/镇区"）。

门禁不用为它写任何新代码：`orchestrator.ts` 的 `blockedReasonFor()` 本来就是"辖区级别不是 `federal` / `state` 就必须显式批准"，`township` 天然落在这个分支里，和 county/city/special_district 走同一套治理拦截、前置检查、批准流程，见[县/市级数据源的治理拦截、前置检查与批准](./local-source-approval.md)。
