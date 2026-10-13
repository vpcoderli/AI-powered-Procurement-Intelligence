# 招标生命周期、BidNet 翻页与平台预算

设计与决策见[县/市/镇招标数据补全：设计](../superpowers/specs/2026-09-24-county-data-completeness-design.md)第 5 节；采集与详情补全的完整链路见[爬虫与 Scrapling 详情补全：全链路逻辑](../architecture/crawler-enrichment-flow.md)；县/市/镇源的审批门禁见[县/市级数据源的治理拦截、前置检查与批准](./local-source-approval.md)。本文只讲阶段 1 新增的六件事：招标状态怎么流转、BidNet 怎么翻页、会员锁怎么标注、平台请求预算怎么算、源怎么按活跃度分层、`township` 是什么；第 7 节是阶段 1 的首轮实测，第 8 节补充 2026-10-13 起的截止日规则、定期清扫和 `closed_reason`。

## 1. 招标状态：open → closed → awarded

`bids.lifecycle_status` 三个取值（`frontend/src/lib/bid-lifecycle.ts` 的 `BID_LIFECYCLE_STATUSES`）：

- **`open`**：该招标当前仍在源租户的开放列表上；
- **`closed`**：截止日已过（精确定义见第 8 节），或者在 closed 列表上被看到且没有中标记录；
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
| `unreadable_page` | 某一页的页面读取器一行都没读出来（可能是页面结构变了，也可能抓到了中间的空白页）。该页 Scrapling 自己解析出的行仍会保留，但翻页立即停止，这次运行永远不算 `complete`。读取器没读过、又链到本站以外的行（例如机构公告里指向 Outlook safelinks 的链接，它的 URL 会被当成超长的招标 id）不算招标行，会在这项判断之前被丢弃，条数记在 `metadata.listExtraction.discarded_offsite_rows`（没有丢弃时没有这个键）；读取器没读过、又是本租户自己列表页链接的行（BidNet 的 Open / Closed / Awarded Solicitations 页签；`/<group>/<slug>/…` 和根别名 `/<slug>/…` 两种写法都算，路径比较忽略大小写、末尾 `/`、查询串和锚点，列表页路径下面的招标详情链接不算；不丢弃的话它们会作为永远无法下架的 `open` 招标入库）同样会被丢弃，条数记在 `metadata.listExtraction.discarded_navigation_rows`（同样没有丢弃时没有这个键；既在站外又是列表页路径的行算站外）；某页 Scrapling 的行因此被丢光、而读取器读到了行时，该页改用读取器的行（`metadata.listExtraction.method` 记为 `adapter_fallback`）；第 1 页因此一行不剩、读取器也没读到行时，按下文的空态判定处理 |
| `repeated_page` | "下一页"链接指回了已经抓过的页面，防止死循环 |

只有翻页**自然走到底**（`stopped_reason = "exhausted"`）、从第 1 页开始、每一页 Scrapling 解析出的招标 id 与该页读取器看到的 id 完全一致（读取器没读过、又链到本站以外或是本租户自己列表页链接的行会先被丢弃，不参与这项比较）、没有被 `limit` / `query` 截断、第 1 页打印的总数（例如页面上的"97 Open Solicitations"）每一页都一致且等于收集到的不重复招标数、第 1 页 `<title>` 确实是本租户名字（源 label 去掉"(Platform)"后缀和结尾", XX"州码后逐字比较）——这些条件同时满足时 `metadata.pagination.complete` 才是 `true`。第 1 节的下架动作只在 `complete = true` 时触发。

第 1 页本身一行都读不出来是单独一种情形（`crawler/apsi_crawler/list_extraction.py` 的 `_raise_empty_first_page()`），不算上面的翻页流程：只有当适配器自己的解析器也确认这是"已验证空态"（`VerifiedEmptyListError`：租户确认 + 命中窄集合空态文案）、第 1 页 `<title>` 确认了租户身份、且从第 1 页开始时，才按 `complete = true` 的零条成功处理（`stopped_reason` 固定为 `exhausted`）。第 1 页如果打印着一个大于 0 的总数，却一行都读不出来（Scrapling 和适配器都读不出），这不算空态，是页面结构出了问题：直接抛出 `ListPageReadError`，让整次运行以 `status: "failure"` 收场，而不会被安静地当成"这源确实没有招标"去清空原有的 open 招标。

## 3. 会员锁：BidNet 详情页锁住的字段

BidNet 把发标机构、正文、招标文件、采购联系人这四类信息锁在会员登录之后（`crawler/apsi_crawler/spiders/co_bidnet.py` 的 `BIDNET_DETAIL_ACCESS = {"restricted": ["description", "documents", "contact"], "platform": "BidNet"}`，写进每条招标记录的 `raw_payload.detail_access`）。APSi 不注册 BidNet 账号、不登录、不代抓这些字段——库里这些字段本来就是空的，不是抓取失败。

前端在 `frontend/src/lib/bid-access.ts` 的 `detailAccessFromRawPayload()` 里解析 `raw_payload.detail_access`；招标详情页正文位置由 `frontend/src/components/bids/BidAccessNotice.tsx` 渲染一条带锁形图标的提示条，中文文案固定为"{fields}仅对 {platform} 注册会员开放。"（字段名依次是"正文"、"招标文件"、"采购联系人"，用"、"连接），旁边一个新窗口打开的"在 {platform} 查看"按钮跳到 `source_url`。文案 key 在 `detail.restrictedAccessBody` / `detail.restrictedField_description` / `_documents` / `_contact` / `detail.restrictedFieldSeparator` / `detail.viewOnPlatform`，中英文字典必须同步（`npm run i18n:check`）。

## 4. 平台请求预算

`CRAWLER_PLATFORM_BUDGETS` 按"平台每小时请求数"配置，格式 `bidnet=60,bonfire=30`；不设该变量时只有 `bidnet` 有默认预算（`frontend/src/server/crawler/platform-budget.ts` 的 `DEFAULT_PLATFORM_BUDGETS = { bidnet: 60 }`）。某个平台写 `unlimited` 只是不给它算"每小时额度"（`PlatformTickBudget` 构造时直接跳过 `perHour === null` 的平台，不放进 `allowance`），**不等于这个平台不受任何数量限制**：`unlimited` 和"完全没写进 `CRAWLER_PLATFORM_BUDGETS`"其实是同一种效果——两者都不在 `budgetedFamilies()`（也就是 `configured-runner.ts` 传给调度器的 `uncappedFamilies`）里，因此都要退回旧的"每 tick 每平台最多 10 个源"并发上限（`scheduler.ts` 的 `selectDueSources()`）。真正跳过这个并发上限、只按预算走的，只有写了具体数字（如 `bidnet=60`）的平台。

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

## 7. 首轮实测（2026-09-28，阶段 1 验收）

设计第 12.2 节对阶段 1 的验收标准是两条：BidNet 源不再有截止日已过 2 天以上仍为 `open` 的招标；现有 6 个源的招标都带编号。本节记录第一次在真实 MySQL（本地 `winbids`）上跑通整条链路的结果，命令与查询可以照抄复跑。

**环境。** 整分支终审（最终评审结论 MERGE-READY，见 `.superpowers/sdd/2026-09-24-county-data-completeness-phase1/progress.md`）之后，先 `npm run db:mysql:migrate`：59 条语句应用、183 条跳过，`bids` 新增 `lifecycle_status` / `awarded_date` / `solicitation_number`，`data_sources` 新增 `consecutive_empty_runs`；回填语句把 `is_active = 0` 的旧行置为 `closed`，本库 3,727 条历史招标全部 `is_active = 1`，所以回填了 0 行。然后以 MySQL 模式启动开发服务器，Scrapling 抽取 sidecar 用 `services/scrapling-extractor/run-local.sh` 跑在 `127.0.0.1:8091`，`frontend/.env.development.local` 里放 `CRAWLER_ALLOW_UNAUTHENTICATED_LOCAL_RUN=true`，请求体**不带** `limit`（任何 `limit` 都会让运行不 `complete`，也就不会下架）。

**运行。** 一次 `POST /api/crawler/state/run`，`sources` 为 6 个已批准的 BidNet 租户，2026-09-28 03:18:55 UTC 开始，28.4 秒结束，6/6 成功，没有触发 WAF 挑战。每个源都是 1 页、`stopped_reason = exhausted`、`complete = true`、`requests_made = 1`，列表解析 `metadata.listExtraction.method = scrapling`（主路径，没有回退到适配器解析器）：

| 源 | 运行前 open | 本次抓到 | 新增 | 更新 | 下架（`delisted`） | 运行后 open / closed |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `bidnet_co_city_aurora` | 22 | 16 | 5 | 11 | 11 | 16 / 11 |
| `bidnet_co_denver` | 13 | 5 | 1 | 4 | 9 | 5 / 9 |
| `bidnet_co_jefferson` | 9 | 5 | 1 | 4 | 5 | 5 / 5 |
| `bidnet_mi_washtenaw` | 14 | 10 | 3 | 7 | 7 | 10 / 7 |
| `bidnet_co_boulder` | 0 | 0（已验证空态） | 0 | 0 | 0 | 0 / 0 |
| `bidnet_ny_erie` | 0 | 0（已验证空态） | 0 | 0 | 0 | 0 / 0 |

运行前这 4 个有招标的源共 58 条、全部 `open`，其中 33 条截止日已过 2 天以上；运行后共 68 条（新增 10 条），32 条被判定下架（`raw_payload.lifecycle.closed_reason = "delisted"`），26 条运行前就有的招标仍在列表上、保持 `open`。第一节所述"只在 `complete = true` 的开放列表运行里清缺"正是这里发生的事：6 个租户的第 1 页 `<title>` 都与源 label 一致，所以 6 次运行都够格下架。Boulder、Erie 两个空租户的 `consecutive_empty_runs` 记为 1，其余 4 个为 0（第 5 节的活跃度分层从这次开始计数）。

**验收查询（对 `winbids` 直接执行）。**

```sql
-- 标准 1：没有截止日已过 2 天以上仍为 open 的 BidNet 招标 → 0 行
SELECT id, deadline_date FROM bids
WHERE id LIKE 'bidnet!_%' ESCAPE '!' AND lifecycle_status = 'open'
  AND STR_TO_DATE(deadline_date, '%m/%d/%Y') < CURDATE() - INTERVAL 2 DAY;
-- 标准 2：当前 open 的 BidNet 招标都带编号 → missing = 0
SELECT COUNT(*) AS missing FROM bids
WHERE id LIKE 'bidnet!_%' ESCAPE '!' AND lifecycle_status = 'open' AND COALESCE(solicitation_number, '') = '';
-- 一致性：is_active 恒等于 lifecycle_status = 'open' → 0
SELECT COUNT(*) FROM bids WHERE (lifecycle_status = 'open') <> (is_active = 1);
```

三条查询的结果分别是 **0 行、0、0**，阶段 1 验收通过。运行前基线里 33 条过期 open 招标与运行后 32 条下架之间差的 1 条，是一条仍在租户列表上、本次被更新的招标（26 条保留下来的 open 招标里现在没有任何一条过期），不是漏判。被下架的 32 条是阶段 1 之前入库的旧行，`solicitation_number` 为空且不会再被列表看到，因此第二条查询按设计只看 `open`；新抓到的招标都带编号，例如 `bidnet_co_city_aurora:0000437559` 的 `6162A`、`0000437670` 的 `R-2528`。

**这次没有覆盖到、留给后面阶段的事。** 终审留下三条不阻塞的小问题，归入阶段 3：页面读取器不核对抓到的列表种类是否与请求一致（`base_url` 若误指向 `closed-bids` 会把整页当 open 入库，6 个种子源都指向 `open-bids`，当前不可达）；`seed.ts` / `demo-readiness.ts` 写 `is_active` 时不写 `lifecycle_status`（只影响本地演示数据，下次 migrate 会回填）；MySQL 下架语句的 `SELECT … FOR UPDATE` 可能锁到相邻 id 区间的下一行（并发手动运行会以持久化失败回滚，不会写错数据）。多页租户（`pages_fetched > 1`）和 closed/awarded 列表的翻页这次没有真实样本，仍以离线 fixture 为准，阶段 4 开工时按设计第 14 节抽查。

## 8. 截止日规则、定期清扫与 `closed_reason`（2026-10-13）

第 1 节说 `closed` 的一种来源是"截止日已过"。这一节给出"截止日已过"的精确定义，以及执行它的两个地方：导入时和 worker 的定期清扫。怎么用 `data:integrity` 验证这些改动，见[数据完整性运维](./data-integrity.md)。

### 8.1 原则与读法

**宁可晚关，不可早关。** 门户印出来的截止时间往往没有时区，带着的时区缩写（"CST"）也不可信，文本本身还常有歧义（没写 AM/PM，午夜写成 12:00 AM……）。规则因此在每个有歧义的地方都取**最晚**的读法：一条已经过期的招标多开几个小时，代价很小；一条还在开放的招标被提前关掉，就从搜索里消失了。

实现是 `frontend/src/lib/bid-deadline.ts`，一个纯函数模块（不读时钟、不做字符串到 `Date` 的解析、不依赖服务器时区），规则由同目录的 `bid-deadline.test.ts` 逐条钉住。`parseBidDeadline` 给出字面读法，`bidDeadlineExpiresAtMs` / `bidDeadlinePassed` 给出"最晚读法"，永远不早于字面读法。下面的描述与代码不一致时，以代码为准。

**时区与只有日期的情形**

- 一律按 **UTC−10**（夏威夷，美国各州里最晚结束的一天）读，`DEADLINE_ZONE_OFFSET_MINUTES = -600`；
- 只有日期的截止日 `D` 在 `D+1` 的 00:00（UTC−10）到期，整个 `D` 天都有效；
- 没有 `Z` 或偏移的时刻，当作 UTC−10 的墙上时钟；末尾的时区缩写（`CST`、`PDT`、`ET`）被忽略；
- 明确带 `Z` 或偏移的 ISO 时刻、13 位毫秒或 10 位秒的 epoch、.NET 的 `/Date(毫秒)/` 是精确时刻（`/Date()/` 里毫秒后面可以跟 `±hhmm`，偏移不改变时刻）。

**让招标多开一会儿的读法**

- 美国数字（`10/13/2026 2:00`）和月份英文（`Oct 13, 2026 at 2:00`）两种写法里，**没有 AM/PM 的 1–11 点**可能是被丢掉了 AM/PM 的 12 小时制，按 PM 读法再多留 12 小时；
- **整天**的写法算到所写那天的结束：精确的午夜（`12:00 AM`、`0:00`、`00:00`、`T00:00:00`）；`24:00`；这两种美国写法里没有 AM/PM、秒为 0 的整点 `12:00`（可能是 12:00 AM）；带 `Z` 或偏移的 ISO `T23:59:59`。对带 `Z` 或偏移的 ISO 时刻，"所写那天"是文本里写的日期，不是换算成 UTC 之后的日期。`12:30` 这样的 12 点带分钟，按字面读（当 AM 读会早 12 小时，字面就是最晚的）；
- **精确时刻可能是被转成了时刻的美国日期**：epoch、`/Date()/`、带 `Z` 或偏移的 ISO 时刻，只要在某个美国偏移（UTC−4 到 UTC−10；`/Date()/` 还包括它自己写的那个偏移）下的当地时间恰好是 00:00:00 或 23:59:59，就当作那个当地日期，算到该日的结束；多个都满足时取最晚的；
- ISO 的一位数小时（`2026-10-13 2:00`）可能是手写格式，按 PM 读法再多留 12 小时。ISO 是 24 小时制，`2026-10-13T12:00:00` 就是中午，上面"没有 AM/PM 的 12:00"只适用于两种美国写法；
- ISO 的秒以下小数保留（向上取整到毫秒），不会在所写时刻之前关；`at`、`@` 作时间分隔（`7/7/2026 at 1:30PM`、`Aug 21, 2026 @ 02:00 PM`）都接受。

**永远不到期**：空白、读不懂的文本（`Not Available`、`TBD`）、不存在的日期（`02/30/2026`）、不合法的钟点（`25:00`）、超过 64 个字符的文本，以及字面时刻的 UTC 年份不在 2000–2100 之间的。门户用 `0001-01-01`、`1970-01-01`、`/Date(-62135596800000)/` 表示"没有日期"，按它关招标会把可能还开着的招标藏起来。

示例（均由 `bidDeadlineExpiresAtMs` 实际算出，时刻为 UTC）：

| 文本 | 到期时刻 | 为什么 |
| --- | --- | --- |
| `10/12/2026` | 2026-10-13 10:00 | 只有日期：到 `D+1` 的 00:00（UTC−10） |
| `10/13/2026 2:00 AM` | 2026-10-13 12:00 | 有 AM/PM：按字面，UTC−10 的 02:00 |
| `10/13/2026 2:00` | 2026-10-14 00:00 | 没有 AM/PM：按 PM 读法，UTC−10 的 14:00 |
| `10/13/2026 2:00 PM CST` | 2026-10-14 00:00 | 时区缩写被忽略 |
| `10/13/2026 12:00 AM` | 2026-10-14 10:00 | 午夜：10/13 整天有效 |
| `10/13/2026 12:00` | 2026-10-14 10:00 | 没有 AM/PM 的整点 12:00，可能是 12:00 AM |
| `10/13/2026 12:30` | 2026-10-13 22:30 | 12 点带分钟：按字面 |
| `10/13/2026 24:00` | 2026-10-14 10:00 | 24:00 是当天的结束 |
| `2026-10-13T12:00:00` | 2026-10-13 22:00 | ISO 24 小时制：UTC−10 的中午 |
| `2026-10-13 2:00` | 2026-10-14 00:00 | ISO 一位数小时：按 PM 读法 |
| `2026-10-13T00:00:00Z` | 2026-10-14 10:00 | 带 `Z` 的午夜：所写日期 10/13 整天有效，而不是 UTC 的 10/12 |
| `2026-10-13T23:59:59Z` | 2026-10-14 10:00 | 带 `Z` 的 23:59:59：到所写日期结束 |
| `2026-10-13T05:00:00Z` | 2026-10-14 10:00 | 在 UTC−5 是 00:00:00，像是被转成时刻的 10/13 |
| `2026-10-13T08:00:00-05:00` | 2026-10-13 13:00 | 精确时刻 |
| `2026-10-13T08:00:00.5-05:00` | 2026-10-13 13:00:00.500 | 保留小数 |
| `0001-01-01`、`1970-01-01`、`Not Available`、`02/30/2026` | 永不到期 | 占位或读不懂 |

### 8.2 在哪里执行

1. **导入时。** 两个 JSON 导入器共用的 `bid-intake.ts` 在合并每条招标时传入 `now`——这次运行的 `finishedAt`（没有则 `startedAt`）。`mergeLifecycleFields` 在状态为 open、且截止日（传入的 `deadline_date`，没有就用库里的）按规则已到期时，把招标存成 `closed`、`is_active = 0`，并在 `raw_payload.lifecycle` 里记 `deadline_passed`（8.3）。`awarded` 的招标不会被降级为 `closed`。反过来，这次导入说它是 open、截止日又在将来，就把此前关闭的招标重新打开；新 payload 整体替换旧 payload，所以重新打开的招标不会带着过期的 `closed_reason`。读不懂的截止日不会关招标。
2. **清扫。** 导入只管门户这次还列出来的招标；门户已经不再列出、或者所在的源很久没被抓的 open 招标会一直开着。`sweepExpiredBids`（`frontend/src/server/bids/lifecycle-sweep.ts`）对库里已有的 open 招标应用同一条规则。`crawler-worker` 每个 tick 在列表和预检队列之后跑一次（`worker-tick.ts`），间隔是 `CRAWLER_WORKER_INTERVAL_MS`（默认 15 分钟），worker 正在停止时跳过；一次性命令是 `npm run bids:lifecycle:sweep [--dry-run] [--json]`。日志、预演和排查见[数据完整性运维](./data-integrity.md)第 5 节。

   清扫按 `id` 顺序每页 500 条读 open 招标（不读 payload）；页内到期的招标在写锁下重读并再判断一次——刚被导入刷新的招标不会按过期的截止日关闭——然后一页一个事务地关闭：`lifecycle_status = 'closed'`、`is_active = 0`、`updated_at`，并记原因。SQLite 用 `BEGIN IMMEDIATE`；MySQL 用 `FOR UPDATE SKIP LOCKED`，**要求 MySQL ≥ 8.0.1**：导入正持有的招标这一轮跳过，留给下一轮，不会阻塞导入，也不会与它死锁。只处理 open 的招标，所以重复跑是安全的。

### 8.3 `closed_reason`

招标被程序关闭时，原因记在 `raw_payload.lifecycle` 的 `closed_reason` 和 `closed_observed_at` 里，`lifecycle` 里已有的其他键保留：

| `closed_reason` | 谁写 | 条件 | 其他 |
| --- | --- | --- | --- |
| `delisted` | 两个导入器的 `delistMissingOpenBids`（第 1 节） | 一次完整的开放列表运行没再返回这条 open 招标 | `closed_observed_at` 是该次运行的结束时间。payload 不是 JSON 对象时，会被改写成只含 `lifecycle` 的新对象 |
| `deadline_passed` | 导入（`mergePersistedBid`）和清扫 | open 招标的截止日按 8.1 的规则到期 | `closed_observed_at` 是导入的 `now` 或清扫的时刻；`deadline` 是当时的截止日文本。**只在 `raw_payload` 是 JSON 对象时记录**：不是（NULL、纯文本）的，招标照样关闭，payload 原样不动，没有原因 |

没有 reason 的关闭：在 closed / awarded 列表上看到的招标、早期迁移关闭的行（`is_active = 0` 的 open 招标），以及上面那种 payload 不是 JSON 对象的清扫关闭。`awarded` 是状态，不是原因。`data:integrity --compare` 把"从 open 变成 closed，却没有这两个 reason"（中标除外）报成 `closed_without_reason` 警告。
