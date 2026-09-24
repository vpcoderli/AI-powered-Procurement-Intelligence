# 县/市/镇招标数据补全：设计（2026-09-24，决策已确认）

上游：[郡/县数据源主动发现：设计](./2026-09-21-source-discovery-design.md)（含 2026-09-23 修订）、[县/市级数据源治理恢复](./2026-09-16-local-source-governance-recovery-design.md)。运维：`docs/operations/source-discovery.md`、`docs/operations/local-source-approval.md`。

## 1. 要解决的问题

用户 2026-09-24 提出两件事：

1. 把 Township 纳入目标辖区；
2. 之前县郡的内容也要爬取，重新设计，更合理地把数据补全。

第 2 条经确认包含四项，全部要做：补全已接入源的详情、把已发现的候选都抓起来、回补历史招标、把 2026-09-16 被拦下的 4 个县换源抓。

2026-09-24 实测的现状：

| 现状 | 证据 |
| --- | --- |
| 已批准的县/市源 6 个，只有 4 个有数据，共 58 条招标 | 本地 MySQL `data_sources` / `bids` |
| 9/16 之后没有任何一次运行 | 6 个源的 `last_success_at` 都停在 2026-09-16 |
| 约 40% 有"描述"，但全是标题复读；联系人、附件都是 0 | `bids.description` 抽样 |
| 截止日已过的招标仍标"活跃" | 例：Denver 截止 08/25 的招标 `is_active = 1` |
| 819 个发现候选只是 JSON，没注册也没批准 | `ops-evidence/bidnet-discovery-2026-09-21.json` |
| 80 个 Township 被分成 `unknown`（MI 53、NJ 27） | 同上，`review[].reason = classified_unknown` |
| 70 多个 NY/RI/MA/VT 的 "Town of X" 进了 `no_fips_match` | 同上 |
| **11 个纽约 "Town of X" 被配成同名 village/city，GEOID 全错** | 例：Town of Rye → Rye city `3664309`，Town of Ossining → Ossining village `3655530` |
| 4 个县（Cuyahoga、Columbus、Franklin OH、Laramie WY）标了 `blocked` | 2026-09-21 反查未命中 |

第三行、倒数第二行是现有设计的缺陷：纽约的 town 与同名 village/city 是两个不同的政府，`name_key` 剥掉 "town of" 后去地名表匹配就撞上了同名的村或市。这批候选还没注册，按本设计重跑发现即可纠正。

## 2. 实测到的事实（2026-09-24）

用 crawler 自己的 `requests` 客户端做了 5 次公开页请求（间隔 ≥ 4 秒），另用网络检索核对了 4 个县的采购入口。

| 事实 | 证据 |
| --- | --- |
| BidNet 详情页公开部分只有：编号、标题、地点、发布日期、截止时间（含时区） | Denver `0000435243` 详情页 |
| **发标机构、正文、招标文件、采购联系人都是 "Locked / Registered members only"** | 同上 |
| 租户开放列表每行：编号（`sol-num`）、标题、地区、发布日、截止日；不含机构名 | Denver 租户页 |
| 租户页公开链接 `…/solicitations/closed-bids?selectedContent=BUYER` 与 `…/awarded-bids?selectedContent=BUYER` | 同上 |
| closed / awarded 列表：每页 25 条，有翻页（Denver 分别 20+ 页、16+ 页），字段同开放列表，日期列分别为"Closed Bid"与"Awarded"，按该日期倒序 | Denver 两个历史列表 |
| 州组列表（`/colorado/solicitations/open-bids`）每页 25 条、有翻页，但**每行不标机构** | 科罗拉多组首页 |
| 因此机构归属只能靠租户页；按租户抓是必需的 | 同上 |
| **Laramie County, WY 其实在 BidNet**：`/colorado/laramiecountywyominggovernment`，挂在科罗拉多组下 | 网络检索 + 2026-09-21 存档（被判为 CO 的 `no_fips_match`） |
| Franklin County, OH 用自有站 `bids.franklincountyohio.gov`：服务端渲染表格（编号、标题、开标日、联系人），详情 `bids.cfm?id=N`，文件是公开 PDF | 网络检索 |
| City of Columbus 用 Bonfire（`columbus.bonfirehub.com`），列表由前端加载；仓库已有 Bonfire 平台适配器（公开 JSON 端点） | 网络检索 + `crawler/apsi_crawler/spiders/bonfire.py` |
| Cuyahoga County 主入口是 Infor 供应商门户，需注册；只有公共工程局的"Open and Upcoming Bids"页公开（RQ 编号 + 补遗 PDF） | 实测页面 |
| worker 每 15 分钟一个 tick，每平台每 tick 最多 10 个源，同平台间隔 ≥ 5 秒 → BidNet 上限约 960 次运行/天 | `scripts/crawler-worker.ts`、`scheduler.ts`、`platform-deferral.ts` |
| 任务默认 `limit = 25`，超过的记录被截掉 | `state-runner.ts` |
| 现有批量批准接口一次最多 100 个，只写通用备注，不写复核人/ToS/预检 | `api/admin/data-sources/batch/route.ts`（9/16 四个 404 源就是这样被批准的） |
| 单源预检已把结论写回 `live_health_disposition`（ready/empty/needs_fix）与 `live_health_reviewed_at`，robots 写回 `robots_txt_*` | `src/server/admin/source-precheck.ts` |
| 搜索只返回 `is_active` 的招标 | `src/server/bids/service.ts` |

## 3. 决策（用户 2026-09-24 确认）

1. **范围**：四项全做（已接入源补全、候选全部接入、历史回补、4 县换源），并纳入 Township。
2. **详情边界**：只取公开内容。BidNet 会员才能看的正文、文件、联系人不取，改为明确标注并给原链接。不登录、不注册账号、不绕 WAF。
3. **批量审批**：平台级合规审查 + 每源自动预检，只有预检通过的才能批量批准，并把审查记录写进每个源的台账。
4. **历史窗口**：近 24 个月（closed + awarded）。
5. **辖区级别**：新增 `township` 级别，对齐美国政府普查（Census of Governments）的"镇/镇区政府"类别，同时收纳 NY/新英格兰/WI 的 town。
6. **推进方式**：一份总设计，分阶段实施。先做共享底座，再按阶段推进，4 个县并行。

仍然有效的旧决策：不注册特别区（2026-09-21 决策 3）；GEOID 不做模糊匹配；发现只读、手动运行。

## 4. 阶段总览

| 阶段 | 交付 | 依赖 |
| --- | --- | --- |
| 1 共享底座 | 招标状态模型；BidNet 列表解析升级（编号、翻页、三种列表）；`township` 级别全链路；平台请求预算与活跃度分层；会员锁标注 | — |
| 2 发现 | Township/Town 分类与 Census 县以下行政区匹配；跨州修正；重跑发现 | 阶段 1 的 `township` 级别 |
| 3 批量接入 | 平台审查；预检入队；带台账的批量批准（同时收紧旧接口）；注册并批准约 950 个源 | 阶段 1 的预算；阶段 2 的候选 |
| 4 历史回补 | closed/awarded 近 24 个月；断点续跑；搜索"含历史"开关 | 阶段 1 的解析器与预算；阶段 3 的源 |
| 并行线 | 4 个县：Laramie 改指 BidNet 正确租户；Franklin 官网；Columbus Bonfire；Cuyahoga 公共工程局 | 阶段 1；Laramie 另需阶段 2、3 |

约 950 个租户**只在阶段 1 的预算与解析器就位之后**才开始跑。每个阶段单独出实施计划、多 subagent 实施。

## 5. 阶段 1：共享底座

### 5.1 招标状态模型

`bids` 新增三列：

| 列 | 取值 | 说明 |
| --- | --- | --- |
| `lifecycle_status` | `open` / `closed` / `awarded` | 迁移时按 `is_active` 回填（1 → open，否则 closed） |
| `awarded_date` | 文本日期，可空 | 取自 awarded 列表 |
| `solicitation_number` | 文本，可空 | 平台给的招标编号（BidNet `sol-num`） |

`is_active` 保留，恒等于 `lifecycle_status = 'open'`，搜索与现有代码不用改读法。

状态流转在 `persistence-merge.ts` 里统一实现，两种数据库共用，在每次运行的同一个事务里完成：

- **开放列表完整抓完**（最后一页没有"下一页"，且没有被页数或条数上限截断）时：本次出现的 → `open`；该源此前 `open`、本次没出现的 → `closed`，`raw_payload.lifecycle.closed_reason = "delisted"`。"该源的招标"用导入器现有的来源键圈定：`bids.source`，即源的 label（招标 id 为 `<label>:<source_bid_id>`）。核实为空的租户（`metadata.emptyState`）同样按"完整抓完、零条出现"处理。
- 抓取失败或被截断：**一律不改**任何状态。
- closed 列表出现的 → `closed`，并补截止日。awarded 列表出现的 → `awarded`，并写 `awarded_date`。
- `awarded` 永远不会被降回 `closed`；开放列表再次出现则按平台现状回到 `open`。
- 这些规则只对能报告"列表完整"的适配器生效，本期是 BidNet。州级源等其余适配器行为不变。
- 保存搜索提醒的匹配器只看本次**新变为 `open`** 的招标，closed/awarded 永不触发提醒。

### 5.2 BidNet 列表解析升级

- 每行多采集编号（`sol-num`）与地区（`sol-region`）。编号写入 `solicitation_number`，详情页展示、可被搜索。
- 同一个解析器识别三种列表：`open`（"Closing" 日期）、`closed`（"Closed Bid"）、`awarded`（"Awarded"）。
- 跟随"下一页"翻页，每页只抓一次，页间隔沿用 BidNet 的 3 秒。开放列表默认最多 4 页（100 条），可按源在 `fetch_config` 里调整。BidNet 租户任务不再受默认 `limit = 25` 截断；`STATE_CRAWLER_LIMIT` 仍然有效，但被它截断的运行算"不完整"。
- 隐藏的空态模板行（`aria-hidden`）在三种列表上都存在，继续只认可见文字。

### 5.3 `fetch-task` 契约变化

请求新增（均可省，省略时行为与现在一致）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `list_kind` | `open` | `open` / `closed` / `awarded` |
| `start_page` | 1 | 从第几页开始 |
| `max_pages` | 4 | 本次最多抓几页 |
| `stop_before` | 无 | ISO 日期；整页都早于它就停（历史回补用） |

结果新增：

- `metadata.pagination = {start_page, pages_fetched, next_page, complete, requests_made, stopped_reason}`，其中 `stopped_reason` 为 `exhausted` / `max_pages` / `window` / `limit`；
- 每条招标多出 `lifecycle_status`、`solicitation_number`、`awarded_date`；
- `raw_payload.detail_access = {"restricted": ["description", "documents", "contact"], "platform": "BidNet"}`。

两个 JSON 导入器与跨语言集成测试同步更新。

### 5.4 `township` 级别全链路

加到所有级别枚举：`register-sources.ts` 的合法级别；`scheduler.ts` 的级别顺序（federal、state、county、city、township、special_district）；管理端批量运行面板的级别与计数；批准对话框；中英文标签（"Township / town"，"镇/镇区"）。治理门禁本来就拦截所有非联邦、非州级的源，township 自动受控，不需要改。

### 5.5 平台请求预算与活跃度分层

**预算**

- 按"每平台每小时请求数"配置，默认 `bidnet=60`，可用 `CRAWLER_PLATFORM_BUDGETS` 覆盖（如 `bidnet=60,bonfire=30`）。未配置的平台沿用现有"每 tick 每平台 10 个源"的上限。
- worker 是唯一的批量执行者。每个 tick 分到"小时额度 × tick 时长 / 1 小时"（默认 15 分钟 → 15 次），按优先级使用：
  1. 日常开放列表；
  2. 批量预检（阶段 3）；
  3. 每周状态检查（awarded 列表第 1 页）；
  4. 历史回补（阶段 4）。
- 每个任务先按 `max_pages` 预扣，跑完按 `pagination.requests_made` 退还。额度用完的任务等下一个 tick，不算失败。
- 管理端的单源操作（手动预检、手动运行）不占预算，但仍守平台最小间隔。
- 遇到挑战或限流信号：沿用现有的"本 tick 同平台其余源延后"，并把该平台暂停 30 分钟（暂停状态保存在 worker 内存里）。

**活跃度分层**

- `data_sources` 新增 `consecutive_empty_runs`：成功且核实为空时 +1，出现招标时清零。
- 对县/市/镇级源：最近一次成功运行有开放招标的按自身 `cadence` 跑（默认每天）；连续 3 次核实为空的放宽到每周；一出现招标就恢复。
- 估算（约 950 个租户，假设一半有开放招标）：日常约 590 次/天，每周状态检查约 140 次/天，BidNet 60 次/小时 = 1,440 次/天，剩余约 700 次/天给预检与历史回补。首轮全量跑完后按实测调参。

### 5.6 会员锁标注

招标详情页读取 `raw_payload.detail_access`。在正文位置显示"正文、招标文件和采购联系人仅对 BidNet 注册会员开放"，加一个"在 BidNet 查看"按钮（`source_url`），中英文。`bid-description.ts` 不变：标题复读仍然不当正文。

## 6. 阶段 2：发现——Township/Town 与跨州修正

### 6.1 分类（`classify_agency(name, state_code)`，自上而下）

| 级别 | 规则 |
| --- | --- |
| `special_district` | 不变，仍然最优先（"X Township Board of Education" 仍是特别区） |
| `county` | 不变 |
| `township` | 名字含 `township` / `twp` / `charter township`（任何州）；或者在 NY、CT、ME、MA、NH、RI、VT、WI 里名字以 `town of` 开头或以 `town` 结尾 |
| `city` | 不变；其他州的 "Town of X"（CO、NC、NJ 等地的 town 是建制市镇）仍归这里 |
| `unknown` | 其余 |

### 6.2 Census 县以下行政区

- 刷新脚本新增第三个 gazetteer：县以下行政区（`<年份>_Gaz_cousubs_national.zip`）。文件名与字段在阶段 2 开工时核实。
- 只收在运作的政府（FUNCSTAT = A）且名称以 `township`、`charter township` 或 `town` 结尾的行，TSV 里 `level = cousub`，GEOID 10 位。
- 文件头照例记录来源 URL、生成日期与过滤规则。
- `name_key` 增加前缀 `charter township of`、`township of`，增加后缀 `township`、`twp`；剥掉 `township` 后如果剩下的末词是 `charter`，一并剥掉（"Delta Charter Township" → `delta`）。地名表和郡表里没有以这些词结尾的名字，现有匹配结果不变。

### 6.3 匹配与 id

- `township` 级别只查 `cousub` 行，同州精确匹配。
- 机构名带 "Charter" 时只在 charter township 里找；不带时两类都找。
- 同州多条同名（例：密歇根多个县都有 Richmond Township，目录不给县名）→ `ambiguous_match` 进待审。不做前缀规则，不猜。
- id：`bidnet_<州>_<name_key>_<类型词>`，类型词取自匹配到的 Census 名称（town → `town`，township / charter township → `township`），例如 `bidnet_ny_rye_town`、`bidnet_mi_bloomfield_township`。这样不会和同名城市撞成 `_2`。
- 候选 `jurisdictionLevel = issuerType = "township"`，`jurisdictionName` 取 Census 官方名（如 `Rye town`）。
- 可救回多少（80 个 Township + 约 70 个 Town）在阶段 2 实测记录。纽约那 11 个配错的 town 在重跑后必须换成 10 位 town GEOID。

### 6.4 跨州修正

机构名在逗号后写明另一个州（`", Wyoming"`、`", WY"`）时，以名字为准覆盖采购组推出来的州，候选的 `discovery.stateSource` 记为 `"name"`（否则为 `"group"`）。名字里不带逗号的州名一律不算（`City of Idaho Springs`、`City of Iowa Park`、`Colorado River Indian Tribes` 都不受影响）。2026-09-21 全量目录里受影响的只有科罗拉多组下的怀俄明机构。

`Laramie County, Wyoming Government` 因此按 WY 走郡名前缀规则拿到 Laramie County（56021），反查给 `bidnet_wy_laramie` 一条 `partial` 建议。按运行手册改指旧行，不另注册新 id。

### 6.5 契约变化

- `levels` 可选值加 `township`，默认改为 `["county", "city", "township"]`。
- `stats` 增加 `township` 桶，恒等式改为五桶之和 = `agencies`。
- 反查的级别确认同样适用于 township。
- `register-sources.ts` 接受 `township`。

## 7. 阶段 3：批量接入与治理

### 7.1 平台级审查（新表 `platform_reviews`）

一条记录表示"某平台在某天被审查过一次"：

| 列 | 说明 |
| --- | --- |
| `id`、`provider_family` | 如 `bidnet`、`bonfire` |
| `tos_url`、`tos_reviewed_at` | BidNet 为 `https://www.bidnetdirect.com/tsandcs` |
| `robots_url`、`robots_checked_at`、`robots_summary` | 经 `fetch-robots` 取得 |
| `access_boundary` | 固定写明：只读公开列表与详情页；不登录、不取会员内容、不绕 WAF |
| `reviewer`、`legal_opinion_reference` | 复核人、法务依据 |
| `reviewed_at`、`next_review_at` | 下次复核日期 |
| `notes`、`created_by`、`created_at` | — |

- 每个平台取 `reviewed_at` 最新、且 `next_review_at` 未到期的一条作为有效审查。
- 管理端加平台审查面板：admin 新建/续期，operator/support 只读；每次写审计事件。
- 路由登记到角色覆盖与 MySQL 覆盖测试的注册表。
- 过期后不能再批量批准该平台的源；已批准的源照常运行，控制台提示"平台审查到期"。

### 7.2 预检入队

- 复用单源预检（robots + 不入库试抓 + 404 时租户探测），不改它的结论与写回方式。
- 新增 `data_sources.precheck_requested_at`。管理端按钮与 `npm run source:precheck -- --provider bidnet --pending` 只做标记，由 worker 按预算优先级 2 执行，完成后清除标记。
- 同一主机的 robots.txt 每轮只取一次。遇挑战即停，下个 tick 续跑。
- 预检把当时使用的 `base_url` 记入结论备注，供批准时核对。

### 7.3 带台账的批量批准

批量批准本地源（county/city/township/special_district）时逐个检查，任一不满足就跳过并返回原因：

1. 该平台有有效的平台审查；
2. 预检结论（`live_health_disposition`）是 `ready` 或 `empty`，且 `live_health_reviewed_at` 不超过 14 天；
3. 当前 `base_url` 与预检时一致。

通过的源一次写好：

- `approval_status = approved`、`approved_for_ingestion = 1`、`legal_review_status = approved_public`；
- `compliance_reviewer`、`tos_url`、`tos_reviewed`、`legal_opinion_reference` 取自平台审查，`compliance_review_due_at` 取平台审查的 `next_review_at`；
- `approval_notes` = "依据平台审查 #<id>；预检 <结论> @<时间>"。

现有批量批准接口按同一规则收紧：本地源不能再无台账批准。联邦与州级源不受影响。管理端显示分组计数（可批准 / 待预检 / 需修正 / 缺平台审查），"批准全部可批准项"按 100 个一批提交。

`needs_fix` 的源保持未批准，列出租户探测给的建议地址，绝不自动改指。非平台源（如 Franklin 官网）仍走现有的单源预检与批准表单。

### 7.4 流程

```
discover-sources（阶段 2 规则）→ 人工审阅 → npm run source:register（未批准行）
  → 预检入队 → worker 按预算执行预检 → 带台账的批量批准
  → 按活跃度分层调度（阶段 1）
```

## 8. 阶段 4：历史回补

### 8.1 范围与窗口

对每个已批准的 BidNet 租户，读 `closed-bids` 与 `awarded-bids` 两个公开列表（`?selectedContent=BUYER`）。窗口按列表自身的日期列计算：closed 用截止日，awarded 用授标日，向前 24 个月。列表按该日期倒序，所以整页都早于窗口起点时停止。每次任务另有页数上限兜底，防止排序假设不成立时无限翻页。

### 8.2 分块与续跑（新表 `source_list_sync`）

每个（源，列表种类）一行：`backfill_status`（pending/running/done/failed）、`window_start`、`next_page`、`pages_fetched`、`rows_seen`、`attempts`、`last_error`、`next_check_at`、`updated_at`。

- 每个任务最多 4 页，占预算优先级 4，跑完推进游标。
- 失败最多重试 3 次并退避；超过则记 `failed`，控制台可见。不影响源健康。
- awarded 行回补完成后转为维护状态：`next_check_at` 每 7 天到期一次，只抓第 1 页（即 §5.5 的每周状态检查）。closed 列表不需要维护，下架检测已覆盖。
- 每个任务写一行 `crawler_logs`（`source = "history_backfill"`），与附件修复同一做法。

### 8.3 入库

- 历史行按 closed/awarded 状态、`is_active = 0` 入库；已存在的招标只更新状态与日期（§5.1 规则）。
- 历史任务不运行匹配器与通知器，匹配器本身也只看新变为 open 的招标，双保险。

### 8.4 搜索与展示

- 搜索默认仍只看 open。新增"含历史（已截止/已授标）"开关，对应 API 参数 `includeHistory`。
- 招标详情显示状态徽标、授标日期与编号。

## 9. 并行线：4 个县

| 机构 | 做法 | 能拿到什么 |
| --- | --- | --- |
| Laramie County, WY | 阶段 2 修正后反查给出正确租户 `/colorado/laramiecountywyominggovernment`；按运行手册改指旧行 `bidnet_wy_laramie` 的 `base_url`，重新启用，走阶段 3 的预检与批量批准 | 与其他 BidNet 租户相同 |
| Franklin County, OH | 新源 `oh_franklin_county_purchasing`（county，39049）：自有站表格列表 + 详情页补全 + 公开 PDF 归档；走单源预检与批准表单，单独核 robots 与 ToS | 完整内容，含文件 |
| City of Columbus, OH | 新源 `bonfire_oh_columbus`（city，3918000），用现有 Bonfire 平台适配器（`fetch_config.tenant = "columbus"`）；为 Bonfire 建一条平台审查，以后接 Bonfire 机构可以直接走批量流程 | 公开字段；文件要 Bonfire 账号的部分按 §5.6 标注。公共服务局的 BidExpress 不在本期 |
| Cuyahoga County, OH | 新源 `oh_cuyahoga_public_works`（county，39035），只接公共工程局公开页（按条目抽取 + 补遗 PDF）；主入口 Infor 需注册，不碰，写进该源的批准备注 | 仅公共工程局 |

`bidnet_oh_franklin`、`bidnet_oh_cuyahoga`、`bidnet_oh_city_columbus` 保持 `blocked`，批准备注补一句指向新源。每个新源在开工时实测页面结构、robots 与 ToS，结果写进运维文档。

## 10. 数据模型汇总

两种数据库都要实现。新表放进 `migrate.ts` 第一个 `sqlite.exec` 块，MySQL 才能自动派生；新列走 `addXColumn` 与 MySQL 的增列迁移。

| 对象 | 变化 |
| --- | --- |
| `bids` | + `lifecycle_status`、`awarded_date`、`solicitation_number`；+ 索引 `(source, lifecycle_status)` |
| `data_sources` | + `consecutive_empty_runs`、`precheck_requested_at` |
| 新表 `platform_reviews` | §7.1 |
| 新表 `source_list_sync` | §8.2 |
| `crawler/data/us_jurisdictions.tsv` | + `cousub` 行（§6.2） |
| `fetch-task` 契约 | §5.3 |
| `discover-sources` 契约 | §6.5 |
| 级别枚举 | + `township`（§5.4） |

## 11. 错误处理

| 情况 | 处理 |
| --- | --- |
| WAF 挑战 / 限流 | 不绕过；本 tick 同平台延后，平台暂停 30 分钟 |
| 列表抓取失败或被截断 | 不改任何招标状态 |
| 预算用完 | 任务等下一个 tick，不算失败 |
| 预检 `needs_fix` | 保持未批准，只给建议，不自动改指 |
| 平台审查过期 | 不能再批量批准，已批准源照常运行并提示 |
| 历史回补失败 | 重试 3 次后记 `failed`，不影响源健康 |
| 发现里州码冲突 | 只认"逗号 + 州名/州码"，其余沿用采购组 |

## 12. 测试与验收

### 12.1 自动化测试

- **Python**：township/town 分类（按州、优先级）；`cousub` 表加载与匹配（charter 限定、歧义）；跨州规则（含三个不受影响的反例）；township id 规则；BidNet 解析器（编号、翻页、三种列表、隐藏空态行、截断判定）；历史窗口停止规则。解析器 fixture 取自 2026-09-24 实测的 Denver 开放/closed/awarded 页与科罗拉多组页。
- **TS**：两种数据库的状态流转（完整/截断/失败/核实为空、awarded 不降级、重新上架）；匹配器跳过非 open；平台审查增改与过期；批量批准三项检查与旧接口收紧；预检队列；调度预算、优先级、退还、暂停与活跃度分层；历史游标；`includeHistory` 搜索；会员锁标注渲染；township 枚举与 i18n 检查。
- **集成**：`test:crawler-integration` 加一个 MySQL 用例，覆盖翻页、状态流转与历史入库。

### 12.2 验收（实测结果写进运维文档）

| 阶段 | 标准 |
| --- | --- |
| 1 | BidNet 源不再有截止日已过 2 天以上仍为 open 的招标；现有 6 个源的招标都带编号 |
| 2 | 重跑发现后记录新增 township/town 候选数；纽约 11 个 town 的 GEOID 全部正确；`bidnet_wy_laramie` 拿到建议 |
| 3 | 已批准的 BidNet 租户 ≥ 95% 在批准后 48 小时内至少跑过一次；出现 WAF 挑战时在暂停期后恢复 |
| 4 | 全部已批准租户的历史回补在 7 天内完成 |
| 并行线 | 4 个新源/改指源预检通过、首次运行成功（Cuyahoga 主门户与 Columbus 文件除外，属公开边界之外） |

## 13. 边界（不做）

- 不登录、不注册账号、不取会员内容、不绕 WAF、不解验证码。
- 不注册特别区；GEOID 不模糊匹配。
- 发现仍然只读、手动；不做发现 worker。
- 州级源的状态流转、BidExpress、Cuyahoga Infor 门户不在本期。

## 14. 风险与待实测项

| 项 | 何时核实 |
| --- | --- |
| BidNet 对持续 60 次/小时的容忍度 | 阶段 3 首轮全量 |
| 有开放招标的租户占比（影响预算分配） | 阶段 3 首轮全量 |
| Township/Town 实际匹配率与歧义数 | 阶段 2 开工 |
| Census 县以下行政区文件名与 FUNCSTAT 字段 | 阶段 2 开工 |
| closed/awarded 列表倒序假设（只在 Denver 核实过） | 阶段 4 开工抽查多个租户；页数上限兜底 |
| Bonfire 公开字段范围、robots 与 ToS | 并行线 Columbus 开工 |
| Franklin、Cuyahoga 自有站的 robots 与 ToS、页面稳定性 | 并行线开工 |
| 招标按源 label 关联数据源：改 label 会让旧招标脱钩、下架检测也随之失效（现有行为，本期沿用同一个键，不改） | 实施时在运维文档注明"改 label 前先评估" |
